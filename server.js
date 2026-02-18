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
let timerInterval = null;

io.on('connection', (socket) => {
    socket.on('joinGame', (username) => {
        if (!players.find(p => p.id === socket.id)) {
            players.push({ id: socket.id, name: username, role: null, alive: true });
        }
        io.emit('updatePlayerList', players);
    });

    socket.on('sendMessage', (data) => {
        const player = players.find(p => p.id === socket.id);
        if (!player) return;

        if (data.type === 'vampire') {
            if (player.role === 'Vampir' && gameState === 'night') {
                const vamps = players.filter(p => p.role === 'Vampir').map(p => p.id);
                vamps.forEach(vId => io.to(vId).emit('receiveMessage', { name: `[VAMPİR] ${player.name}`, text: data.text, color: '#ff4b5c' }));
            }
        } else {
            io.emit('receiveMessage', { name: player.name, text: data.text });
        }
    });

    socket.on('startGame', () => {
        if (players.length < 3) return; 
        let pool = [...players];
        const vIndex = Math.floor(Math.random() * pool.length);
        const vampire = pool.splice(vIndex, 1)[0];
        
        let seer = pool.length > 0 ? pool.splice(Math.floor(Math.random() * pool.length), 1)[0] : null;
        let doctor = pool.length > 0 ? pool.splice(Math.floor(Math.random() * pool.length), 1)[0] : null;

        players.forEach(p => {
            p.alive = true;
            if (p.id === vampire.id) p.role = 'Vampir';
            else if (seer && p.id === seer.id) p.role = 'Kahin';
            else if (doctor && p.id === doctor.id) p.role = 'Doktor';
            else p.role = 'Köylü';
            io.to(p.id).emit('assignRole', p.role);
        });
        startNight();
    });

    function startNight() {
        gameState = "night";
        votes = {};
        protectedId = null;
        io.emit('gameUpdate', { state: "night", message: "🌙 Gece oldu. Vampirler avda...", players });
    }

    socket.on('vampireAction', (targetId) => {
        if (gameState !== "night") return;
        let victim = players.find(p => p.id === targetId);
        let news = victim && targetId !== protectedId ? `💀 ${victim.name} öldü.` : "🏥 Kimse ölmedi.";
        if (victim && targetId !== protectedId) victim.alive = false;
        startDay(news);
    });

    socket.on('doctorAction', (targetId) => { protectedId = targetId; socket.emit('announcement', "🛡️ Korunuyor."); });
    socket.on('seerAction', (targetId) => {
        const t = players.find(p => p.id === targetId);
        if (t) socket.emit('announcement', `🔮 ${t.name} bir ${t.role}!`);
    });

    function startDay(news) {
        if (checkGameOver()) return;
        gameState = "day";
        votes = {};
        io.emit('gameUpdate', { state: "day", message: `☀️ ${news} Oylama başladı!`, players });
        
        let timeLeft = 60;
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            timeLeft--;
            io.emit('timerUpdate', timeLeft);
            if (timeLeft <= 0) {
                clearInterval(timerInterval);
                tallyVotes();
            }
        }, 1000);
    }

    socket.on('castVote', (targetId) => {
        if (gameState === "day") {
            votes[socket.id] = targetId;
            const aliveCount = players.filter(p => p.alive).length;
            if (Object.keys(votes).length >= aliveCount) {
                clearInterval(timerInterval);
                tallyVotes();
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
            io.emit('announcement', `📢 ${victim.name} asıldı!`);
            io.emit('deathEffect', victim.id);
        }
        if (!checkGameOver()) setTimeout(startNight, 3000);
    }

    function checkGameOver() {
        const vamps = players.filter(p => p.role === 'Vampir' && p.alive);
        const citizens = players.filter(p => p.role !== 'Vampir' && p.alive);
        let winner = vamps.length === 0 ? "KÖYLÜLER KAZANDI! 🏆" : (vamps.length >= citizens.length ? "VAMPİRLER KAZANDI! 🧛" : "");
        if (winner) { io.emit('gameOver', { winner }); setTimeout(() => { players.forEach(p => {p.role=null; p.alive=true;}); io.emit('returnToLobby'); }, 6000); return true; }
        return false;
    }

    socket.on('disconnect', () => { players = players.filter(p => p.id !== socket.id); io.emit('updatePlayerList', players); });
});

server.listen(3000, '0.0.0.0', () => console.log('3D Server Ready'));