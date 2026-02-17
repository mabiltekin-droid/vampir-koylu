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
        const exists = players.find(p => p.id === socket.id);
        if (!exists) {
            players.push({ id: socket.id, name: username, role: null, alive: true });
        }
        io.emit('updatePlayerList', players);
    });

    socket.on('startGame', () => {
        if (players.length < 2) return; 
        
        const vampireIndex = Math.floor(Math.random() * players.length);
        players.forEach((p, i) => {
            p.role = (i === vampireIndex) ? 'Vampir' : 'Köylü';
            p.alive = true;
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

// BURAYI TEK SATIRA DÜŞÜRDÜK VE 0.0.0.0 EKLEDİK
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Sunucu ${PORT} portunda başarıyla başlatıldı!`);
});