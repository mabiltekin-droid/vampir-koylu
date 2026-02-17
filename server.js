const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let players = [];
let gameState = "waiting"; 
let votes = {}; 
let protectedId = null; 

io.on('connection', (socket) => {
    socket.on('joinGame', (username) => {
        const exists = players.find(p => p.id === socket.id);
        if (!exists) {
            players.push({ id: socket.id, name: username, role: null, alive: true });
        }
        io.emit('updatePlayerList', players);
    });

    socket.on('startGame', () => {
        if (players.length < 3) return; 
        
        let pool = [...players];
        const vIndex = Math.floor(Math.random() * pool.length);
        const vampire = pool.splice(vIndex, 1)[0];
        const dIndex = Math.floor(Math.random() * pool.length);
        const doctor = pool.splice(dIndex, 1)[0];

        players.forEach(p => {
            if (p.id === vampire.id) p.role = 'Vampir';
            else if (p.id === doctor.id) p.role = 'Doktor';
            else p.role = 'Köylü';
            p.alive = true;
            io.to(p.id).emit('assignRole', p.role);
        });
        startNight();
    });

    function startNight() {
        gameState = "night";
        votes = {};
        protectedId = null;
        io.emit('gameUpdate', { 
            state: "night", 
            message: "🌙 Gece çöktü... Roller gizli görevlerini yapıyor.", 
            players: players 
        });
    }

    socket.on('doctorAction', (targetId) => {
        const doc = players.find(p => p.id === socket.id);
        if (gameState === "night" && doc && doc.role === 'Doktor' && doc.alive) {
            protectedId = targetId;
            socket.emit('announcement', "🛡️ Bu oyuncuyu bu gece koruyorsun!");
        }
    });

    socket.on('vampireAction', (targetId) => {
        const v = players.find(p => p.id === socket.id);
        if (gameState === "night" && v && v.role === 'Vampir' && v.alive) {
            if (targetId === protectedId) {
                startDay("🏥 Doktor bir hayat kurtardı! Kimse ölmedi.");
            } else {
                const victim = players.find(p => p.id === targetId);
                if (victim) {
                    victim.alive = false;
                    startDay(`💀 ${victim.name} dün gece kurban edildi.`);
                }
            }
        }
    });

    function startDay(news) {
        if (checkGameOver()) return;
        gameState = "day";
        io.emit('gameUpdate', { state: "day", message: `☀️ Gün doğdu! ${news} Şimdi oylama vakti.`, players });
    }

    socket.on('castVote', (targetId) => {
        if (gameState === "day") {
            const voter = players.find(p => p.id === socket.id);
            if (voter && voter.alive) {
                votes[socket.id] = targetId;
                const aliveOnes = players.filter(p => p.alive);
                if (Object.keys(votes).length >= aliveOnes.length) tallyVotes();
            }
        }
    });

    function tallyVotes() {
        const counts = {};
        Object.values(votes).forEach(id => counts[id] = (counts[id] || 0) + 1);
        let lynchedId = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b, null);
        const victim = players.find(p => p.id === lynchedId);
        if (victim) {
            victim.alive = false;
            io.emit('announcement', `📢 Köylüler toplandı ve ${victim.name} asıldı!`);
        }
        if (!checkGameOver()) setTimeout(startNight, 3000);
    }

    function checkGameOver() {
        const vamps = players.filter(p => p.role === 'Vampir' && p.alive);
        const citizens = players.filter(p => p.role !== 'Vampir' && p.alive);
        if (vamps.length === 0) {
            io.emit('announcement', "🏆 KÖYLÜLER KAZANDI!");
            return true;
        } else if (vamps.length >= citizens.length) {
            io.emit('announcement', "🧛 VAMPİRLER KAZANDI!");
            return true;
        }
        return false;
    }

    socket.on('disconnect', () => {
        players = players.filter(p => p.id !== socket.id);
        io.emit('updatePlayerList', players);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Aktif: ${PORT}`));