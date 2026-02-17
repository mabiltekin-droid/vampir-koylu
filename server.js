const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let players = [];
let gameState = "waiting"; // waiting, night, day

io.on('connection', (socket) => {
    console.log('Bir oyuncu bağlandı:', socket.id);

    socket.on('joinGame', (username) => {
        // Eğer oyuncu zaten listede yoksa ekle (Sayfa yenilemelerinde hata olmaması için)
        const exists = players.find(p => p.id === socket.id);
        if (!exists) {
            players.push({ id: socket.id, name: username, role: null, alive: true });
        }
        io.emit('updatePlayerList', players);
    });

    socket.on('startGame', () => {
        // Render'da test ederken 2 kişiyle de bakabilmen için sınırı 2 yaptım, 
        // ama gerçek oyun için burayı tekrar 3 veya 5 yapabilirsin.
        if (players.length < 2) return; 
        
        // Rolleri Dağıt
        const vampireIndex = Math.floor(Math.random() * players.length);
        players.forEach((p, i) => {
            p.role = (i === vampireIndex) ? 'Vampir' : 'Köylü';
            p.alive = true; // Herkesi canlı başlat
            io.to(p.id).emit('assignRole', p.role);
        });

        gameState = "night";
        io.emit('gameStarted', { state: gameState, players: players });
    });

    socket.on('disconnect', () => {
        console.log('Bir oyuncu ayrıldı:', socket.id);
        players = players.filter(p => p.id !== socket.id);
        io.emit('updatePlayerList', players);
    });
});

// RENDER İÇİN KRİTİK DEĞİŞİKLİK:
// Portu ortam değişkeninden al, yoksa 3000 kullan.
const PORT = process.env.PORT || 3000;
const PORT = process.env.PORT || 3000;

// '0.0.0.0' eklemek Render'ın dışarıdan erişim sağlaması için bazen kritiktir
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Sunucu ${PORT} portunda aktif!`);
});