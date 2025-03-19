const TelegramBot = require('node-telegram-bot-api');

// Токен берётся из переменной окружения для безопасности
const token = process.env.TELEGRAM_TOKEN || '7811945406:AAHJ0Lua-lWI6quqG5lPr_cqAfKTeB5YU5M';
const bot = new TelegramBot(token, { polling: true });

// Хранение данных в памяти
const admins = {};
const antifloodEnabled = {};
const messageTracker = {};

let botId;

bot.getMe().then((me) => {
    botId = me.id;
    console.log(`Бот запущен! ID бота: ${botId}`);
}).catch((error) => {
    console.error('Ошибка при получении ID бота:', error);
});

// Обработка ошибок polling
bot.on('polling_error', (error) => {
    console.error('Ошибка polling:', error.code, error.message);
});

// Форматирование даты
function formatDate(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
}

// Уровни администраторов
const adminLevels = {
    0: { nominative: 'Пользователь', accusative: 'Пользователя' },
    1: { nominative: 'Мл. модератор', accusative: 'Мл. модератора' },
    2: { nominative: 'Модератор', accusative: 'Модератора' },
    3: { nominative: 'Администратор', accusative: 'Администратора' },
    4: { nominative: 'Зам. главного администратора', accusative: 'Зам. главного администратора' },
    5: { nominative: 'Главный администратор', accusative: 'Главного администратора' }
};

// При добавлении бота в чат
bot.on('new_chat_members', async (msg) => {
    const chatId = msg.chat.id;
    const newMembers = msg.new_chat_members;

    if (newMembers.some(member => member.id === botId)) {
        admins[chatId] = {};
        antifloodEnabled[chatId] = false;
        messageTracker[chatId] = {};
        await bot.sendMessage(chatId, 'Выдайте права администратора и напишите /start для активации бота 🤖 (Только создатель беседы может активировать бота).');
    }
});

// Обработка сообщений
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.toLowerCase();
    const senderId = msg.from.id;

    console.log(`Сообщение в чате ${chatId}: ${text} от ${senderId}`);

    // Анти-флуд
    if (antifloodEnabled[chatId] && text && senderId !== botId) {
        const currentTime = Date.now();
        messageTracker[chatId] = messageTracker[chatId] || {};
        messageTracker[chatId][senderId] = messageTracker[chatId][senderId] || {};

        const userMessages = messageTracker[chatId][senderId];
        if (!userMessages[text]) {
            userMessages[text] = { count: 1, timestamp: currentTime };
        } else {
            const timeDiff = (currentTime - userMessages[text].timestamp) / 1000;
            if (timeDiff < 60) {
                userMessages[text].count += 1;
                if (userMessages[text].count > 3) {
                    const sender = msg.from;
                    const senderName = `${sender.first_name}${sender.last_name ? ' ' + sender.last_name : ''}`;
                    const muteUntil = new Date(currentTime + 30 * 60 * 1000);
                    const untilDate = Math.floor(muteUntil.getTime() / 1000);

                    try {
                        await bot.restrictChatMember(chatId, senderId, {
                            can_send_messages: false,
                            can_send_media_messages: false,
                            can_send_polls: false,
                            can_send_other_messages: false,
                            until_date: untilDate
                        });
                        await bot.sendMessage(chatId, `${senderName} получил-(а) мут на 30 минут.\nПричина: flood`);
                        delete messageTracker[chatId][senderId];
                    } catch (error) {
                        console.error('Ошибка при выдаче мута за флуд:', error.code, error.message);
                    }
                    return;
                }
            } else {
                userMessages[text] = { count: 1, timestamp: currentTime };
            }
        }

        for (const msgText in userMessages) {
            if ((currentTime - userMessages[msgText].timestamp) / 1000 >= 60) {
                delete userMessages[msgText];
            }
        }
    }

    // Команда /start
    if (text === '/start') {
        try {
            const telegramAdmins = await bot.getChatAdministrators(chatId);
            const isBotAdmin = telegramAdmins.some(admin => admin.user.id === botId);

            if (!isBotAdmin) {
                await bot.sendMessage(chatId, 'Выдайте мне права администратора для активации бота 🤖');
                return;
            }

            const creator = telegramAdmins.find(admin => admin.status === 'creator');
            if (!creator || creator.user.id !== senderId) {
                await bot.sendMessage(chatId, 'Только создатель беседы может активировать бота с помощью /start.');
                return;
            }

            if (!admins[chatId] || Object.keys(admins[chatId]).length === 0) {
                admins[chatId] = {};
                admins[chatId][senderId] = 5;
                console.log(`Назначен главный администратор ${senderId} для чата ${chatId}`);
                await bot.sendMessage(chatId, 'Бот успешно активирован ✅');
            } else {
                await bot.sendMessage(chatId, 'Бот уже активирован.');
            }
        } catch (error) {
            console.error('Ошибка при активации:', error.code, error.message);
            await bot.sendMessage(chatId, 'Произошла ошибка при активации бота.');
        }
    }

    // Команда /antifloodon
    if (text === '/antifloodon') {
        const senderLevel = admins[chatId]?.[senderId] || 0;
        if (senderLevel < 5) {
            await bot.sendMessage(chatId, 'У вас нет прав для выполнения этой команды. Требуется уровень "Главный администратор".');
            return;
        }

        if (antifloodEnabled[chatId]) {
            await bot.sendMessage(chatId, 'Анти-флуд уже включён.');
        } else {
            antifloodEnabled[chatId] = true;
            messageTracker[chatId] = {};
            await bot.sendMessage(chatId, 'Анти-флуд успешно включён.');
        }
    }

    // Команда /antifloodoff
    if (text === '/antifloodoff') {
        const senderLevel = admins[chatId]?.[senderId] || 0;
        if (senderLevel < 5) {
            await bot.sendMessage(chatId, 'У вас нет прав для выполнения этой команды. Требуется уровень "Главный администратор".');
            return;
        }

        if (!antifloodEnabled[chatId]) {
            await bot.sendMessage(chatId, 'Анти-флуд уже выключен.');
        } else {
            antifloodEnabled[chatId] = false;
            messageTracker[chatId] = {};
            await bot.sendMessage(chatId, 'Анти-флуд успешно выключен.');
        }
    }

    // Команда /help
    if (text === '/help') {
        const helpMessage = [
            'Список команд для всех пользователей:',
            '/help - посмотреть список команд',
            '/info - посмотреть информацию о боте',
            '',
            'Список команд для мл. модераторов:',
            'Нет',
            '',
            'Список команд для модераторов:',
            '/mute - выдать блокировку к использованию чата',
            '/unmute - снять блокировку к использованию чата',
            '/kick - исключить пользователя из группы',
            '',
            'Команды для администраторов:',
            '/addmlmoder - поставить пользователя на пост "Мл. Модератор"',
            '/delmlmoder - снять пользователя с поста "Мл. Модератор"',
            '/addmoder - поставить пользователя на пост "Модератор"',
            '/delmoder - снять пользователя с поста "Модератор"',
            '/ban - заблокировать пользователю доступ к чату',
            '/unban - разблокировать пользователю доступ к чату',
            '',
            'Команды ЗГА:',
            '/addadmin - поставить пользователя на пост "Администратора"',
            '/deladmin - снять пользователя с поста "Администратор"',
            '',
            'Команды ГА:',
            '/addzga - поставить пользователя на пост "Зам. главного администратора"',
            '/delzga - снять пользователя с поста "Зам. главного администратора"',
            '/antifloodon - включить систему анти-флуда',
            '/antifloodoff - выключить систему анти-флуда'
        ].join('\n');

        await bot.sendMessage(chatId, helpMessage);
    }

    // Команда /info
    if (text === '/info') {
        const infoMessage = [
            'Актуальная информация о боте:',
            '',
            'Версия бота: Beta 1.0',
            'Название: UNKNOWN MANAGER',
            'Язык программирования: NodeJS',
            'Назначение: Администрирование бесед',
            'Разработчик: @N1ZZiDENT'
        ].join('\n');

        await bot.sendMessage(chatId, infoMessage);
    }

    // Команда /kick
    if (text && text.startsWith('/kick')) {
        try {
            const telegramAdmins = await bot.getChatAdministrators(chatId);
            const isBotAdmin = telegramAdmins.some(admin => admin.user.id === botId);

            if (!isBotAdmin) {
                await bot.sendMessage(chatId, 'У меня нет прав администратора для исключения участников.');
                return;
            }

            const senderLevel = admins[chatId]?.[senderId] || 0;
            if (senderLevel < 2) {
                await bot.sendMessage(chatId, 'У вас нет прав для выполнения этой команды. Требуется уровень "Модератор" или выше.');
                return;
            }

            if (!msg.reply_to_message) {
                await bot.sendMessage(chatId, 'Ответьте на сообщение пользователя, которого хотите исключить, с командой /kick <причина>');
                return;
            }

            const targetId = msg.reply_to_message.from.id;
            if (targetId === botId) {
                await bot.sendMessage(chatId, 'Я не могу исключить себя!');
                return;
            }

            const targetLevel = admins[chatId]?.[targetId] || 0;
            if (targetLevel >= senderLevel) {
                await bot.sendMessage(chatId, 'Вы не можете исключить администратора выше или равной вашей должности.');
                return;
            }

            const sender = msg.from;
            const senderName = `${sender.first_name}${sender.last_name ? ' ' + sender.last_name : ''}`;
            const target = msg.reply_to_message.from;
            const targetName = `${target.first_name}${target.last_name ? ' ' + target.last_name : ''}`;
            const args = text.split(' ').slice(1).join(' ');
            const reason = args.length > 0 ? args : 'Не указана';

            await bot.banChatMember(chatId, targetId);
            await bot.unbanChatMember(chatId, targetId);

            await bot.sendMessage(chatId, `${senderName} исключил-(а) ${targetName}\nПричина: ${reason}`);
        } catch (error) {
            console.error('Ошибка при исключении:', error.code, error.message);
            await bot.sendMessage(chatId, 'Произошла ошибка при исключении.');
        }
    }

    // Команда /mute
    if (text && text.startsWith('/mute')) {
        try {
            const telegramAdmins = await bot.getChatAdministrators(chatId);
            const isBotAdmin = telegramAdmins.some(admin => admin.user.id === botId);

            if (!isBotAdmin) {
                await bot.sendMessage(chatId, 'У меня нет прав администратора для выдачи мута.');
                return;
            }

            const senderLevel = admins[chatId]?.[senderId] || 0;
            if (senderLevel < 2) {
                await bot.sendMessage(chatId, 'У вас нет прав для выполнения этой команды. Требуется уровень "Модератор" или выше.');
                return;
            }

            if (!msg.reply_to_message) {
                await bot.sendMessage(chatId, 'Ответьте на сообщение пользователя, которого хотите замутить, с командой /mute <минуты> <причина>');
                return;
            }

            const targetId = msg.reply_to_message.from.id;
            if (targetId === botId) {
                await bot.sendMessage(chatId, 'Я не могу замутить себя!');
                return;
            }

            const targetLevel = admins[chatId]?.[targetId] || 0;
            if (targetLevel >= senderLevel) {
                await bot.sendMessage(chatId, 'Вы не можете заблокировать доступ администратору выше или равной вашей должности.');
                return;
            }

            const args = text.split(' ');
            if (args.length < 2 || isNaN(args[1])) {
                await bot.sendMessage(chatId, 'Укажите время мута в минутах, например: /mute 60 <причина>');
                return;
            }

            const minutes = parseInt(args[1], 10);
            if (minutes <= 0) {
                await bot.sendMessage(chatId, 'Время мута должно быть больше 0 минут.');
                return;
            }

            const reason = args.slice(2).join(' ') || 'Не указана';
            const sender = msg.from;
            const senderName = `${sender.first_name}${sender.last_name ? ' ' + sender.last_name : ''}`;
            const target = msg.reply_to_message.from;
            const targetName = `${target.first_name}${target.last_name ? ' ' + target.last_name : ''}`;

            const muteUntil = new Date(Date.now() + minutes * 60 * 1000);
            const untilDate = Math.floor(muteUntil.getTime() / 1000);

            await bot.restrictChatMember(chatId, targetId, {
                can_send_messages: false,
                can_send_media_messages: false,
                can_send_polls: false,
                can_send_other_messages: false,
                until_date: untilDate
            });

            await bot.sendMessage(chatId, `${senderName} замутил-(а) ${targetName}\nПричина: ${reason}\nМут выдан до: ${formatDate(muteUntil)}`);
        } catch (error) {
            console.error('Ошибка при выдаче мута:', error.code, error.message);
            await bot.sendMessage(chatId, 'Произошла ошибка при выдаче мута.');
        }
    }

    // Команда /unmute
    if (text && text.startsWith('/unmute')) {
        try {
            const telegramAdmins = await bot.getChatAdministrators(chatId);
            const isBotAdmin = telegramAdmins.some(admin => admin.user.id === botId);

            if (!isBotAdmin) {
                await bot.sendMessage(chatId, 'У меня нет прав администратора для снятия мута.');
                return;
            }

            const senderLevel = admins[chatId]?.[senderId] || 0;
            if (senderLevel < 2) {
                await bot.sendMessage(chatId, 'У вас нет прав для выполнения этой команды. Требуется уровень "Модератор" или выше.');
                return;
            }

            if (!msg.reply_to_message) {
                await bot.sendMessage(chatId, 'Ответьте на сообщение пользователя, которого хотите размутить, с командой /unmute <причина>');
                return;
            }

            const targetId = msg.reply_to_message.from.id;
            if (targetId === botId) {
                await bot.sendMessage(chatId, 'Я не могу размутить себя!');
                return;
            }

            const targetLevel = admins[chatId]?.[targetId] || 0;
            if (targetLevel >= senderLevel) {
                await bot.sendMessage(chatId, 'Вы не можете снять блокировку с администратора выше или равной вашей должности.');
                return;
            }

            const args = text.split(' ').slice(1).join(' ');
            const reason = args.length > 0 ? args : 'Не указана';
            const sender = msg.from;
            const senderName = `${sender.first_name}${sender.last_name ? ' ' + sender.last_name : ''}`;
            const target = msg.reply_to_message.from;
            const targetName = `${target.first_name}${target.last_name ? ' ' + target.last_name : ''}`;

            await bot.restrictChatMember(chatId, targetId, {
                can_send_messages: true,
                can_send_media_messages: true,
                can_send_polls: true,
                can_send_other_messages: true,
                until_date: 0
            });

            await bot.sendMessage(chatId, `${senderName} размутил-(а) ${targetName}\nПричина: ${reason}`);
        } catch (error) {
            console.error('Ошибка при снятии мута:', error.code, error.message);
            await bot.sendMessage(chatId, 'Произошла ошибка при снятии мута.');
        }
    }

    // Команда /ban
    if (text && text.startsWith('/ban')) {
        try {
            const telegramAdmins = await bot.getChatAdministrators(chatId);
            const isBotAdmin = telegramAdmins.some(admin => admin.user.id === botId);

            if (!isBotAdmin) {
                await bot.sendMessage(chatId, 'У меня нет прав администратора для блокировки пользователей.');
                return;
            }

            const senderLevel = admins[chatId]?.[senderId] || 0;
            if (senderLevel < 3) {
                await bot.sendMessage(chatId, 'У вас нет прав для выполнения этой команды. Требуется уровень "Администратор" или выше.');
                return;
            }

            if (!msg.reply_to_message) {
                await bot.sendMessage(chatId, 'Ответьте на сообщение пользователя, которого хотите заблокировать, с командой /ban <дни> <причина>');
                return;
            }

            const targetId = msg.reply_to_message.from.id;
            if (targetId === botId) {
                await bot.sendMessage(chatId, 'Я не могу заблокировать себя!');
                return;
            }

            const targetLevel = admins[chatId]?.[targetId] || 0;
            if (targetLevel >= senderLevel) {
                await bot.sendMessage(chatId, 'Вы не можете заблокировать администратора выше или равной вашей должности.');
                return;
            }

            const args = text.split(' ');
            if (args.length < 2 || isNaN(args[1])) {
                await bot.sendMessage(chatId, 'Укажите количество дней блокировки, например: /ban 7 <причина>');
                return;
            }

            const days = parseInt(args[1], 10);
            if (days <= 0) {
                await bot.sendMessage(chatId, 'Количество дней должно быть больше 0.');
                return;
            }

            const reason = args.slice(2).join(' ') || 'Не указана';
            const sender = msg.from;
            const senderName = `${sender.first_name}${sender.last_name ? ' ' + sender.last_name : ''}`;
            const target = msg.reply_to_message.from;
            const targetName = `${target.first_name}${target.last_name ? ' ' + target.last_name : ''}`;

            const banUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
            const untilDate = Math.floor(banUntil.getTime() / 1000);

            await bot.banChatMember(chatId, targetId, { until_date: untilDate });

            await bot.sendMessage(chatId, `${senderName} заблокировал-(а) ${targetName} на ${days} дн.\nПричина: ${reason}`);
        } catch (error) {
            console.error('Ошибка при блокировке:', error.code, error.message);
            await bot.sendMessage(chatId, 'Произошла ошибка при блокировке.');
        }
    }

    // Команда /unban
    if (text && text.startsWith('/unban')) {
        try {
            const telegramAdmins = await bot.getChatAdministrators(chatId);
            const isBotAdmin = telegramAdmins.some(admin => admin.user.id === botId);

            if (!isBotAdmin) {
                await bot.sendMessage(chatId, 'У меня нет прав администратора для разблокировки пользователей.');
                return;
            }

            const senderLevel = admins[chatId]?.[senderId] || 0;
            if (senderLevel < 3) {
                await bot.sendMessage(chatId, 'У вас нет прав для выполнения этой команды. Требуется уровень "Администратор" или выше.');
                return;
            }

            if (!msg.reply_to_message) {
                await bot.sendMessage(chatId, 'Ответьте на сообщение пользователя, которого хотите разблокировать, с командой /unban <причина>');
                return;
            }

            const targetId = msg.reply_to_message.from.id;
            if (targetId === botId) {
                await bot.sendMessage(chatId, 'Я не могу разблокировать себя!');
                return;
            }

            const targetLevel = admins[chatId]?.[targetId] || 0;
            if (targetLevel >= senderLevel) {
                await bot.sendMessage(chatId, 'Вы не можете разблокировать администратора выше или равной вашей должности.');
                return;
            }

            const args = text.split(' ').slice(1).join(' ');
            const reason = args.length > 0 ? args : 'Не указана';
            const sender = msg.from;
            const senderName = `${sender.first_name}${sender.last_name ? ' ' + sender.last_name : ''}`;
            const target = msg.reply_to_message.from;
            const targetName = `${target.first_name}${target.last_name ? ' ' + target.last_name : ''}`;

            await bot.unbanChatMember(chatId, targetId);

            await bot.sendMessage(chatId, `${senderName} разблокировал-(а) ${targetName}\nПричина: ${reason}`);
        } catch (error) {
            console.error('Ошибка при разблокировке:', error.code, error.message);
            await bot.sendMessage(chatId, 'Произошла ошибка при разблокировке.');
        }
    }

    // Команда /addmlmoder
    if (text && text.startsWith('/addmlmoder')) {
        try {
            const telegramAdmins = await bot.getChatAdministrators(chatId);
            const isBotAdmin = telegramAdmins.some(admin => admin.user.id === botId);

            if (!isBotAdmin) {
                await bot.sendMessage(chatId, 'У меня нет прав администратора для назначения ролей.');
                return;
            }

            const senderLevel = admins[chatId]?.[senderId] || 0;
            if (senderLevel < 3) {
                await bot.sendMessage(chatId, 'У вас нет прав для выполнения этой команды. Требуется уровень "Администратор" или выше.');
                return;
            }

            if (!msg.reply_to_message) {
                await bot.sendMessage(chatId, 'Ответьте на сообщение пользователя, которому хотите выдать права Мл. модератора.');
                return;
            }

            const targetId = msg.reply_to_message.from.id;
            if (targetId === botId) {
                await bot.sendMessage(chatId, 'Я не могу назначить права себе!');
                return;
            }

            const sender = msg.from;
            const senderName = `${sender.first_name}${sender.last_name ? ' ' + sender.last_name : ''}`;
            const target = msg.reply_to_message.from;
            const targetName = `${target.first_name}${target.last_name ? ' ' + target.last_name : ''}`;

            admins[chatId] = admins[chatId] || {};
            admins[chatId][targetId] = 1;

            await bot.sendMessage(chatId, `${senderName} выдал-(а) права ${adminLevels[1].accusative} пользователю ${targetName}`);
        } catch (error) {
            console.error('Ошибка при назначении Мл. модератора:', error.code, error.message);
            await bot.sendMessage(chatId, 'Произошла ошибка при назначении прав.');
        }
    }

    // Команда /addmoder
    if (text && text.startsWith('/addmoder')) {
        try {
            const telegramAdmins = await bot.getChatAdministrators(chatId);
            const isBotAdmin = telegramAdmins.some(admin => admin.user.id === botId);

            if (!isBotAdmin) {
                await bot.sendMessage(chatId, 'У меня нет прав администратора для назначения ролей.');
                return;
            }

            const senderLevel = admins[chatId]?.[senderId] || 0;
            if (senderLevel < 3) {
                await bot.sendMessage(chatId, 'У вас нет прав для выполнения этой команды. Требуется уровень "Администратор" или выше.');
                return;
            }

            if (!msg.reply_to_message) {
                await bot.sendMessage(chatId, 'Ответьте на сообщение пользователя, которому хотите выдать права Модератора.');
                return;
            }

            const targetId = msg.reply_to_message.from.id;
            if (targetId === botId) {
                await bot.sendMessage(chatId, 'Я не могу назначить права себе!');
                return;
            }

            const sender = msg.from;
            const senderName = `${sender.first_name}${sender.last_name ? ' ' + sender.last_name : ''}`;
            const target = msg.reply_to_message.from;
            const targetName = `${target.first_name}${target.last_name ? ' ' + target.last_name : ''}`;

            admins[chatId] = admins[chatId] || {};
            admins[chatId][targetId] = 2;

            await bot.sendMessage(chatId, `${senderName} выдал-(а) права ${adminLevels[2].accusative} пользователю ${targetName}`);
        } catch (error) {
            console.error('Ошибка при назначении Модератора:', error.code, error.message);
            await bot.sendMessage(chatId, 'Произошла ошибка при назначении прав.');
        }
    }

    // Команда /addadmin
    if (text && text.startsWith('/addadmin')) {
        try {
            const telegramAdmins = await bot.getChatAdministrators(chatId);
            const isBotAdmin = telegramAdmins.some(admin => admin.user.id === botId);

            if (!isBotAdmin) {
                await bot.sendMessage(chatId, 'У меня нет прав администратора для назначения ролей.');
                return;
            }

            const senderLevel = admins[chatId]?.[senderId] || 0;
            if (senderLevel < 4) {
                await bot.sendMessage(chatId, 'У вас нет прав для выполнения этой команды. Требуется уровень "Зам. главного администратора" или выше.');
                return;
            }

            if (!msg.reply_to_message) {
                await bot.sendMessage(chatId, 'Ответьте на сообщение пользователя, которому хотите выдать права Администратора.');
                return;
            }

            const targetId = msg.reply_to_message.from.id;
            if (targetId === botId) {
                await bot.sendMessage(chatId, 'Я не могу назначить права себе!');
                return;
            }

            const sender = msg.from;
            const senderName = `${sender.first_name}${sender.last_name ? ' ' + sender.last_name : ''}`;
            const target = msg.reply_to_message.from;
            const targetName = `${target.first_name}${target.last_name ? ' ' + target.last_name : ''}`;

            admins[chatId] = admins[chatId] || {};
            admins[chatId][targetId] = 3;

            await bot.sendMessage(chatId, `${senderName} выдал-(а) права ${adminLevels[3].accusative} пользователю ${targetName}`);
        } catch (error) {
            console.error('Ошибка при назначении Администратора:', error.code, error.message);
            await bot.sendMessage(chatId, 'Произошла ошибка при назначении прав.');
        }
    }

    // Команда /addzga
    if (text && text.startsWith('/addzga')) {
        try {
            const telegramAdmins = await bot.getChatAdministrators(chatId);
            const isBotAdmin = telegramAdmins.some(admin => admin.user.id === botId);

            if (!isBotAdmin) {
                await bot.sendMessage(chatId, 'У меня нет прав администратора для назначения ролей.');
                return;
            }

            const senderLevel = admins[chatId]?.[senderId] || 0;
            if (senderLevel < 5) {
                await bot.sendMessage(chatId, 'У вас нет прав для выполнения этой команды. Требуется уровень "Главный администратор".');
                return;
            }

            if (!msg.reply_to_message) {
                await bot.sendMessage(chatId, 'Ответьте на сообщение пользователя, которому хотите выдать права Зам. главного администратора.');
                return;
            }

            const targetId = msg.reply_to_message.from.id;
            if (targetId === botId) {
                await bot.sendMessage(chatId, 'Я не могу назначить права себе!');
                return;
            }

            const sender = msg.from;
            const senderName = `${sender.first_name}${sender.last_name ? ' ' + sender.last_name : ''}`;
            const target = msg.reply_to_message.from;
            const targetName = `${target.first_name}${target.last_name ? ' ' + target.last_name : ''}`;

            admins[chatId] = admins[chatId] || {};
            admins[chatId][targetId] = 4;

            await bot.sendMessage(chatId, `${senderName} выдал-(а) права ${adminLevels[4].accusative} пользователю ${targetName}`);
        } catch (error) {
            console.error('Ошибка при назначении ЗГА:', error.code, error.message);
            await bot.sendMessage(chatId, 'Произошла ошибка при назначении прав.');
        }
    }

    // Команда /delmlmoder
    if (text && text.startsWith('/delmlmoder')) {
        try {
            const telegramAdmins = await bot.getChatAdministrators(chatId);
            const isBotAdmin = telegramAdmins.some(admin => admin.user.id === botId);

            if (!isBotAdmin) {
                await bot.sendMessage(chatId, 'У меня нет прав администратора для снятия ролей.');
                return;
            }

            const senderLevel = admins[chatId]?.[senderId] || 0;
            if (senderLevel < 3) {
                await bot.sendMessage(chatId, 'У вас нет прав для выполнения этой команды. Требуется уровень "Администратор" или выше.');
                return;
            }

            if (!msg.reply_to_message) {
                await bot.sendMessage(chatId, 'Ответьте на сообщение пользователя, которого хотите снять с поста Мл. модератора.');
                return;
            }

            const targetId = msg.reply_to_message.from.id;
            if (targetId === botId) {
                await bot.sendMessage(chatId, 'Я не могу снять права с себя!');
                return;
            }

            if (!admins[chatId] || !admins[chatId][targetId] || admins[chatId][targetId] !== 1) {
                await bot.sendMessage(chatId, 'Этот пользователь не является Мл. модератором.');
                return;
            }

            const sender = msg.from;
            const senderName = `${sender.first_name}${sender.last_name ? ' ' + sender.last_name : ''}`;
            const target = msg.reply_to_message.from;
            const targetName = `${target.first_name}${target.last_name ? ' ' + target.last_name : ''}`;
            const args = text.split(' ').slice(1).join(' ');
            const reason = args.length > 0 ? args : 'Не указана';

            delete admins[chatId][targetId];

            await bot.sendMessage(chatId, `${senderName} снял-(а) ${targetName} с поста ${adminLevels[1].accusative}\nПричина: ${reason}`);
        } catch (error) {
            console.error('Ошибка при снятии Мл. модератора:', error.code, error.message);
            await bot.sendMessage(chatId, 'Произошла ошибка при снятии прав.');
        }
    }

    // Команда /delmoder
    if (text && text.startsWith('/delmoder')) {
        try {
            const telegramAdmins = await bot.getChatAdministrators(chatId);
            const isBotAdmin = telegramAdmins.some(admin => admin.user.id === botId);

            if (!isBotAdmin) {
                await bot.sendMessage(chatId, 'У меня нет прав администратора для снятия ролей.');
                return;
            }

            const senderLevel = admins[chatId]?.[senderId] || 0;
            if (senderLevel < 3) {
                await bot.sendMessage(chatId, 'У вас нет прав для выполнения этой команды. Требуется уровень "Администратор" или выше.');
                return;
            }

            if (!msg.reply_to_message) {
                await bot.sendMessage(chatId, 'Ответьте на сообщение пользователя, которого хотите снять с поста Модератора.');
                return;
            }

            const targetId = msg.reply_to_message.from.id;
            if (targetId === botId) {
                await bot.sendMessage(chatId, 'Я не могу снять права с себя!');
                return;
            }

            if (!admins[chatId] || !admins[chatId][targetId] || admins[chatId][targetId] !== 2) {
                await bot.sendMessage(chatId, 'Этот пользователь не является Модератором.');
                return;
            }

            const sender = msg.from;
            const senderName = `${sender.first_name}${sender.last_name ? ' ' + sender.last_name : ''}`;
            const target = msg.reply_to_message.from;
            const targetName = `${target.first_name}${target.last_name ? ' ' + target.last_name : ''}`;
            const args = text.split(' ').slice(1).join(' ');
            const reason = args.length > 0 ? args : 'Не указана';

            delete admins[chatId][targetId];

            await bot.sendMessage(chatId, `${senderName} снял-(а) ${targetName} с поста ${adminLevels[2].accusative}\nПричина: ${reason}`);
        } catch (error) {
            console.error('Ошибка при снятии Модератора:', error.code, error.message);
            await bot.sendMessage(chatId, 'Произошла ошибка при снятии прав.');
        }
    }

    // Команда /deladmin
    if (text && text.startsWith('/deladmin')) {
        try {
            const telegramAdmins = await bot.getChatAdministrators(chatId);
            const isBotAdmin = telegramAdmins.some(admin => admin.user.id === botId);

            if (!isBotAdmin) {
                await bot.sendMessage(chatId, 'У меня нет прав администратора для снятия ролей.');
                return;
            }

            const senderLevel = admins[chatId]?.[senderId] || 0;
            if (senderLevel < 4) {
                await bot.sendMessage(chatId, 'У вас нет прав для выполнения этой команды. Требуется уровень "Зам. главного администратора" или выше.');
                return;
            }

            if (!msg.reply_to_message) {
                await bot.sendMessage(chatId, 'Ответьте на сообщение пользователя, которого хотите снять с поста Администратора.');
                return;
            }

            const targetId = msg.reply_to_message.from.id;
            if (targetId === botId) {
                await bot.sendMessage(chatId, 'Я не могу снять права с себя!');
                return;
            }

            if (!admins[chatId] || !admins[chatId][targetId] || admins[chatId][targetId] !== 3) {
                await bot.sendMessage(chatId, 'Этот пользователь не является Администратором.');
                return;
            }

            const sender = msg.from;
            const senderName = `${sender.first_name}${sender.last_name ? ' ' + sender.last_name : ''}`;
            const target = msg.reply_to_message.from;
            const targetName = `${target.first_name}${target.last_name ? ' ' + target.last_name : ''}`;
            const args = text.split(' ').slice(1).join(' ');
            const reason = args.length > 0 ? args : 'Не указана';

            delete admins[chatId][targetId];

            await bot.sendMessage(chatId, `${senderName} снял-(а) ${targetName} с поста ${adminLevels[3].accusative}\nПричина: ${reason}`);
        } catch (error) {
            console.error('Ошибка при снятии Администратора:', error.code, error.message);
            await bot.sendMessage(chatId, 'Произошла ошибка при снятии прав.');
        }
    }

    // Команда /delzga
    if (text && text.startsWith('/delzga')) {
        try {
            const telegramAdmins = await bot.getChatAdministrators(chatId);
            const isBotAdmin = telegramAdmins.some(admin => admin.user.id === botId);

            if (!isBotAdmin) {
                await bot.sendMessage(chatId, 'У меня нет прав администратора для снятия ролей.');
                return;
            }

            const senderLevel = admins[chatId]?.[senderId] || 0;
            if (senderLevel < 5) {
                await bot.sendMessage(chatId, 'У вас нет прав для выполнения этой команды. Требуется уровень "Главный администратор".');
                return;
            }

            if (!msg.reply_to_message) {
                await bot.sendMessage(chatId, 'Ответьте на сообщение пользователя, которого хотите снять с поста Зам. главного администратора.');
                return;
            }

            const targetId = msg.reply_to_message.from.id;
            if (targetId === botId) {
                await bot.sendMessage(chatId, 'Я не могу снять права с себя!');
                return;
            }

            if (!admins[chatId] || !admins[chatId][targetId] || admins[chatId][targetId] !== 4) {
                await bot.sendMessage(chatId, 'Этот пользователь не является Зам. главного администратора.');
                return;
            }

            const sender = msg.from;
            const senderName = `${sender.first_name}${sender.last_name ? ' ' + sender.last_name : ''}`;
            const target = msg.reply_to_message.from;
            const targetName = `${target.first_name}${target.last_name ? ' ' + target.last_name : ''}`;
            const args = text.split(' ').slice(1).join(' ');
            const reason = args.length > 0 ? args : 'Не указана';

            delete admins[chatId][targetId];

            await bot.sendMessage(chatId, `${senderName} снял-(а) ${targetName} с поста ${adminLevels[4].accusative}\nПричина: ${reason}`);
        } catch (error) {
            console.error('Ошибка при снятии ЗГА:', error.code, error.message);
            await bot.sendMessage(chatId, 'Произошла ошибка при снятии прав.');
        }
    }

    // Команда /staff
    if (text === '/staff') {
        try {
            if (!admins[chatId] || Object.keys(admins[chatId]).length === 0) {
                await bot.sendMessage(chatId, 'Список администраторов пуст. Активируйте бота через /start (требуется создатель беседы).');
                return;
            }

            const adminList = Object.entries(admins[chatId]).filter(([_, level]) => level > 0);
            const userIds = adminList.map(([id]) => parseInt(id));
            const users = await Promise.all(userIds.map(id => bot.getChatMember(chatId, id).catch(() => null)));
            const staffByLevel = { 5: [], 4: [], 3: [], 2: [], 1: [] };

            for (const [userId, level] of adminList) {
                const user = users.find(u => u && u.user.id === parseInt(userId))?.user;
                if (user) {
                    const name = `${user.first_name}${user.last_name ? ' ' + user.last_name : ''}`;
                    const username = user.username ? `@${user.username}` : '';
                    staffByLevel[level].push(`${name} (${username})`);
                }
            }

            const message = [
                'Список администраторов чата:',
                '> Главные администраторы:',
                staffByLevel[5].length > 0 ? staffByLevel[5].join('\n') : 'Нет',
                '> Замы. главного администратора:',
                staffByLevel[4].length > 0 ? staffByLevel[4].join('\n') : 'Нет',
                '> Администраторы:',
                staffByLevel[3].length > 0 ? staffByLevel[3].join('\n') : 'Нет',
                '> Модераторы:',
                staffByLevel[2].length > 0 ? staffByLevel[2].join('\n') : 'Нет',
                '> Мл. модераторы:',
                staffByLevel[1].length > 0 ? staffByLevel[1].join('\n') : 'Нет'
            ].join('\n');

            await bot.sendMessage(chatId, message);
        } catch (error) {
            console.error('Ошибка при выполнении /staff:', error.code, error.message);
            await bot.sendMessage(chatId, 'Произошла ошибка при получении списка администраторов.');
        }
    }
});

// Удержание процесса активным
process.on('uncaughtException', (error) => {
    console.error('Необработанная ошибка:', error);
});

console.log('Бот запущен и работает...');
