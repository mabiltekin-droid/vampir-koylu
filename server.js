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

    // Voice Chat Sinyalleşme
    socket.on('voice-signal', (data) => {
        io.to(data.to).emit('voice-signal', {
            signal: data.signal,
            from: socket.id
        });
    });

    socket.on('startGame', () => {
        if (players.length < 2) return; 
        
        let pool = [...players];
        const vIndex = Math.floor(Math.random() * pool.length);
        const vampire = pool.splice(vIndex, 1)[0];
        
        let doctor = null;
        if (pool.length > 0) {
            const dIndex = Math.floor(Math.random() * pool.length);
            doctor = pool.splice(dIndex, 1)[0];
        }

        players.forEach(p => {
            if (p.id === vampire.id) p.role = 'Vampir';
            else if (doctor && p.id === doctor.id) p.role = 'Doktor';
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
        io.emit('gameUpdate', { state: "night", message: "🌙 Gece oldu. Sessiz olun...", players });
    }

    socket.on('vampireAction', (targetId) => {
        if (gameState === "night" && targetId !== protectedId) {
            const victim = players.find(p => p.id === targetId);
            if (victim) victim.alive = false;
            startDay(`💀 ${victim ? victim.name : "Biri"} gece öldü.`);
        } else {
            startDay("🏥 Doktor birini kurtardı!");
        }
    });

    socket.on('doctorAction', (targetId) => { protectedId = targetId; });

    function startDay(news) {
        if (checkGameOver()) return;
        gameState = "day";
        votes = {}; // Oyları sıfırla
        io.emit('gameUpdate', { state: "day", message: `☀️ ${news} Tartışın ve oylayın!`, players });
    }

    socket.on('castVote', (targetId) => {
        if (gameState === "day") {
            votes[socket.id] = targetId;
            const aliveCount = players.filter(p => p.alive).length;
            
            // Canlı oyuncu sayısı kadar oy gelmişse veya çoğunluk sağlanmışsa
            if (Object.keys(votes).length >= aliveCount) {
                tallyVotes();
            }
            io.emit('voteUpdate', Object.keys(votes).length); // Kaç kişinin oy verdiğini göster
        }
    });

    function tallyVotes() {
        const counts = {};
        Object.values(votes).forEach(id => counts[id] = (counts[id] || 0) + 1);
        let lynchedId = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b, null);
        
        const victim = players.find(p => p.id === lynchedId);
        if (victim) victim.alive = false;
        
        io.emit('announcement', `📢 Köy kararıyla ${victim ? victim.name : "kimse"} asıldı!`);
        if (!checkGameOver()) setTimeout(startNight, 3000);
    }

    function checkGameOver() {
        const vamps = players.filter(p => p.role === 'Vampir' && p.alive);
        const citizens = players.filter(p => p.role !== 'Vampir' && p.alive);
        if (vamps.length === 0) { io.emit('announcement', "🏆 KÖYLÜLER KAZANDI!"); return true; }
        if (vamps.length >= citizens.length) { io.emit('announcement', "🧛 VAMPİRLER KAZANDI!"); return true; }
        return false;
    }

    socket.on('disconnect', () => {
        players = players.filter(p => p.id !== socket.id);
        io.emit('updatePlayerList', players);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server: ${PORT}`));