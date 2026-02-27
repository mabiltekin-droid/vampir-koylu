const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Oyun Değişkenleri
let players = {}; // {id: {x, y, username, role, isAlive}}
let gameState = 'LOBBY'; // LOBBY, DAY, NIGHT, VOTING
let votes = {}; // {voterId: votedId}

io.on('connection', (socket) => {
    console.log('Yeni oyuncu bağlandı:', socket.id);

    // 1. Oyuncu Katılımı
    socket.on('joinGame', (username) => {
        players[socket.id] = {
            id: socket.id,
            x: Math.floor(Math.random() * 700) + 50,
            y: Math.floor(Math.random() * 500) + 50,
            username: username,
            role: 'unknown',
            isAlive: true
        };
        // Herkese yeni oyuncuyu bildir
        io.emit('currentPlayers', players);
    });

    // 2. Hareket Senkronizasyonu
    socket.on('playerMovement', (movementData) => {
        if (players[socket.id] && players[socket.id].isAlive) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            // Diğerlerine bu oyuncunun hareketini bildir
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    // 3. Oyun Başlangıcı ve Rol Dağıtımı
    socket.on('startGame', () => {
        const ids = Object.keys(players);
        if (ids.length >= 3) { // Minimum 3 oyuncu
            // Rastgele bir vampir seç
            const vampireId = ids[Math.floor(Math.random() * ids.length)];
            
            ids.forEach(id => {
                players[id].role = (id === vampireId) ? 'Vampire' : 'Villager';
                // Rollere özel mesaj gönder (Sadece kendisine)
                io.to(id).emit('yourRole', players[id].role);
            });
            
            gameState = 'DAY';
            io.emit('gameStateChanged', gameState);
        }
    });

    // 4. Oyuncu Ayrılması
    socket.on('disconnect', () => {
        console.log('Oyuncu ayrıldı:', socket.id);
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Oyun sunucusu hazır: http://localhost:${PORT}`));