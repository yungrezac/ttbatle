const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');

const app = express();
const server = http.createServer(app);
// Настраиваем Socket.io для связи с виджетом в реальном времени
const io = new Server(server, { cors: { origin: '*' } });

// Отдаем наш единственный HTML файл и статику (если будет)
app.use(express.static(__dirname));
app.use(express.json());

// Хранилище активных подключений к стримам и статистика донатов
const activeStreams = {};
const battleData = {};

io.on('connection', (socket) => {
    console.log('Новое подключение виджета/панели:', socket.id);

    socket.on('join_stream', (tiktokUsername) => {
        if (!tiktokUsername) return;
        socket.join(tiktokUsername);
        console.log(`Виджет подключился к комнате: ${tiktokUsername}`);

        // Если мы еще не подключены к этому стримеру через TikTok API
        if (!activeStreams[tiktokUsername]) {
            const tiktokLiveConnection = new WebcastPushConnection(tiktokUsername);

            tiktokLiveConnection.connect().then(state => {
                console.log(`Успешно подключено к стриму: ${tiktokUsername}`);
                activeStreams[tiktokUsername] = tiktokLiveConnection;
                battleData[tiktokUsername] = {};

                // Слушаем подарки
                tiktokLiveConnection.on('gift', data => {
                    if (!battleData[tiktokUsername]) return;
                    
                    const userId = data.userId;
                    // Если пользователь донатит впервые за батл, создаем запись
                    if (!battleData[tiktokUsername][userId]) {
                        battleData[tiktokUsername][userId] = {
                            name: data.uniqueId,
                            avatar: data.profilePictureUrl,
                            points: 0
                        };
                    }
                    
                    // Считаем очки (количество бриллиантов * множитель комбо)
                    const pointsAdded = data.diamondCount * data.repeatCount;
                    battleData[tiktokUsername][userId].points += pointsAdded;
                    
                    console.log(`[${tiktokUsername}] ${data.uniqueId} отправил подарок! Очки: ${battleData[tiktokUsername][userId].points}`);
                });

                // Обработка завершения стрима
                tiktokLiveConnection.on('streamEnd', () => {
                    console.log(`Стрим ${tiktokUsername} завершен.`);
                    delete activeStreams[tiktokUsername];
                });

            }).catch(err => {
                console.error(`Ошибка подключения к ${tiktokUsername}:`, err);
                io.to(tiktokUsername).emit('error', 'Не удалось подключиться к стриму TikTok');
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('Виджет/Панель отключены:', socket.id);
    });
});

// API для панели управления (чтобы запускать видео миссий и завершать батл)
app.post('/api/trigger-mission', (req, res) => {
    const { username, missionType } = req.body;
    // Отправляем команду виджету включить видео
    io.to(username).emit('mission_start', { type: missionType });
    res.json({ success: true });
});

app.post('/api/end-mission', (req, res) => {
    const { username } = req.body;
    // Отправляем команду виджету убрать видео
    io.to(username).emit('mission_end');
    res.json({ success: true });
});

app.post('/api/end-battle', (req, res) => {
    const { username } = req.body;
    const data = battleData[username] || {};

    // Вычисляем Топ 3 донатеров
    const topDonators = Object.values(data)
        .sort((a, b) => b.points - a.points)
        .slice(0, 3);

    // Отправляем данные для анимации Топ 3
    io.to(username).emit('battle_end', { top3: topDonators });

    // Сбрасываем данные для следующего батла
    battleData[username] = {};
    res.json({ success: true });
});

// Запуск сервера. Railway использует process.env.PORT
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер виджета запущен на порту ${PORT}`);
});
