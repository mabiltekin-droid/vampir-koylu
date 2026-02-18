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
        if (!players.find(p => p.id === socket.id)) {
            players.push({ id: socket.id, name: username, role: null, alive: true });
        }
        io.emit('updatePlayerList', players);
    });

    // Chat Sistemi
    socket.on('sendMessage', (msg) => {
        const player = players.find(p => p.id === socket.id);
        if (player) {
            io.emit('receiveMessage', { name: player.name, text: msg });
        }
    });

    socket.on('startGame', () => {
        if (players.length < 4) return; // Kahin dahil olunca en az 4 kişi önerilir
        let pool = [...players];
        
        // Rol Dağıtımı
        const vIndex = Math.floor(Math.random() * pool.length);
        const vampire = pool.splice(vIndex, 1)[0];
        
        const sIndex = Math.floor(Math.random() * pool.length);
        const seer = pool.splice(sIndex, 1)[0];
        
        const dIndex = Math.floor(Math.random() * pool.length);
        const doctor = pool.splice(dIndex, 1)[0];

        players.forEach(p => {
            p.alive = true;
            if (p.id === vampire.id) p.role = 'Vampir';
            else if (p.id === seer.id) p.role = 'Kahin';
            else if (p.id === doctor.id) p.role = 'Doktor';
            else p.role = 'Köylü';
            io.to(p.id).emit('assignRole', p.role);
        });
        startNight();
    });

    function startNight() {
        gameState = "night";
        votes = {};
        protectedId = null;
        io.emit('gameUpdate', { state: "night", message: "🌙 Gece oldu. Kurtlar uluyor...", players });
        io.emit('playSound', 'night');
    }

    socket.on('vampireAction', (targetId) => {
        if (gameState !== "night") return;
        let killNews = "";
        if (targetId === protectedId) {
            killNews = "🏥 Doktor müdahale etti, kimse ölmedi!";
        } else {
            const victim = players.find(p => p.id === targetId);
            if (victim) { victim.alive = false; killNews = `💀 ${victim.name} dün gece kurban edildi.`; }
        }
        startDay(killNews);
    });

    socket.on('doctorAction', (targetId) => {
        if (gameState !== "night") return;
        protectedId = targetId;
        socket.emit('announcement', "🛡️ Bu oyuncuyu koruyorsun.");
    });

    // Kahin Aksiyonu
    socket.on('seerAction', (targetId) => {
        if (gameState !== "night") return;
        const target = players.find(p => p.id === targetId);
        if (target) {
            socket.emit('announcement', `🔮 Görü: ${target.name} bir ${target.role}!`);
        }
    });

    function startDay(news) {
        if (checkGameOver()) return;
        gameState = "day";
        votes = {};
        io.emit('gameUpdate', { state: "day", message: `☀️ ${news} Oylama vakti!`, players });
        io.emit('playSound', 'day');
    }

    socket.on('castVote', (targetId) => {
        if (gameState === "day") {
            votes[socket.id] = targetId;
            const aliveCount = players.filter(p => p.alive).length;
            if (Object.keys(votes).length >= aliveCount) tallyVotes();
        }
    });

    function tallyVotes() {
        const counts = {};
        Object.values(votes).forEach(id => counts[id] = (counts[id] || 0) + 1);
        let lynchedId = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b, null);
        const victim = players.find(p => p.id === lynchedId);
        if (victim) { victim.alive = false; io.emit('announcement', `📢 Köy ${victim.name}'i asmaya karar verdi!`); }
        if (!checkGameOver()) setTimeout(startNight, 3000);
    }

    function checkGameOver() {
        const vamps = players.filter(p => p.role === 'Vampir' && p.alive);
        const citizens = players.filter(p => p.role !== 'Vampir' && p.alive);
        let winner = "";
        if (vamps.length === 0) winner = "KÖYLÜLER KAZANDI! 🏆";
        else if (vamps.length >= citizens.length) winner = "VAMPİRLER KAZANDI! 🧛";

        if (winner !== "") {
            io.emit('gameOver', { winner: winner });
            setTimeout(() => {
                gameState = "waiting";
                players.forEach(p => { p.role = null; p.alive = true; });
                io.emit('returnToLobby', players);
            }, 6000);
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
server.listen(PORT, '0.0.0.0', () => console.log(`Server aktif: ${PORT}`));