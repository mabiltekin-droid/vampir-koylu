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
let actions = { protectedId: null, vampireTarget: null };
let timer = null;
let totalTasksCompleted = 0;

io.on('connection', (socket) => {
    socket.on('joinGame', (username) => {
        if (!players.find(p => p.id === socket.id)) {
            players.push({ id: socket.id, name: username, role: null, alive: true, tasks: [], completedTasks: 0 });
        }
        io.emit('updatePlayerList', players);
    });

    // OYUNU SIFIRLAMA (Yönetici Tuşu için)
    socket.on('adminResetGame', () => {
        gameState = "waiting";
        if (timer) clearInterval(timer);
        players.forEach(p => {
            p.role = null;
            p.alive = true;
            p.tasks = [];
            p.completedTasks = 0;
        });
        votes = {};
        actions = { protectedId: null, vampireTarget: null };
        totalTasksCompleted = 0;
        io.emit('reload'); // Herkesin ekranını temizle
    });

    socket.on('startGame', () => {
        if (players.length < 3) return;
        gameState = "starting";
        totalTasksCompleted = 0;
        let pool = [...players];
        pool.sort(() => Math.random() - 0.5);

        players.forEach((p, idx) => {
            p.alive = true;
            p.tasks = ["Kuyudan su çek", "Kapıyı kilitle", "Parşömen oku"].sort(() => Math.random() - 0.5);
            if (idx === 0) p.role = 'Vampir';
            else if (idx === 1) p.role = 'Kahin';
            else if (idx === 2) p.role = 'Doktor';
            else p.role = 'Köylü';
            io.to(p.id).emit('assignRole', { role: p.role, tasks: p.tasks });
        });
        startNight();
    });

    function startNight() {
        gameState = "night";
        votes = {}; // Oyları her gece temizle
        actions = { protectedId: null, vampireTarget: null };
        io.emit('gameUpdate', { state: "night", message: "🌙 Gece... Vampir kurbanını seçiyor.", players });
    }

    socket.on('nightAction', (data) => {
        const p = players.find(p => p.id === socket.id);
        if (!p || !p.alive || gameState !== "night") return;
        if (p.role === 'Vampir') actions.vampireTarget = data.targetId;
        if (p.role === 'Doktor') actions.protectedId = data.targetId;
        if (p.role === 'Kahin') {
            const t = players.find(t => t.id === data.targetId);
            if (t) socket.emit('announcement', `🔮 Görü: ${t.name} bir ${t.role}!`);
        }
    });

    socket.on('finishNight', () => {
        if (gameState !== "night") return;
        let news = "🏥 Gece sakin geçti, kimse ölmedi.";
        if (actions.vampireTarget && actions.vampireTarget !== actions.protectedId) {
            const victim = players.find(v => v.id === actions.vampireTarget);
            if (victim) { victim.alive = false; news = `💀 ${victim.name} gece saldırıya uğradı!`; }
        }
        startDay(news);
    });

    function startDay(news) {
        if (checkGameOver()) return;
        gameState = "day";
        votes = {}; // Önemli: Gündüz başında oyları sıfırla
        io.emit('gameUpdate', { state: "day", message: news, players });
        
        let timeLeft = 30;
        if (timer) clearInterval(timer);
        timer = setInterval(() => {
            timeLeft--;
            io.emit('timerUpdate', timeLeft);
            if (timeLeft <= 0) {
                clearInterval(timer);
                tallyVotes();
            }
        }, 1000);
    }

    socket.on('castVote', (targetId) => {
        if (gameState !== "day") return;
        votes[socket.id] = targetId;
        const alivePlayers = players.filter(p => p.alive).length;
        if (Object.keys(votes).length >= alivePlayers) {
            clearInterval(timer);
            tallyVotes();
        }
    });

    function tallyVotes() {
        if (gameState !== "day") return; // Çift tetiklenmeyi engelle
        const counts = {};
        Object.values(votes).forEach(id => counts[id] = (counts[id] || 0) + 1);
        
        const lynchedId = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b, null);
        const victim = players.find(v => v.id === lynchedId);
        
        if (victim) {
            victim.alive = false;
            io.emit('announcement', `📢 Köylüler toplandı ve ${victim.name} kişisini astı!`);
        } else {
            io.emit('announcement', "📢 Kimse asılmadı.");
        }

        votes = {}; // Temizlik
        if (!checkGameOver()) {
            gameState = "transition"; // Donmayı engellemek için ara durum
            setTimeout(startNight, 4000);
        }
    }

    function checkGameOver() {
        const v = players.filter(p => p.role === 'Vampir' && p.alive);
        const c = players.filter(p => p.role !== 'Vampir' && p.alive);
        let winner = v.length === 0 ? "KÖYLÜLER" : (v.length >= c.length ? "VAMPİRLER" : null);
        if (winner) {
            io.emit('gameOver', { winner });
            gameState = "waiting";
            return true;
        }
        return false;
    }

    socket.on('sendMessage', (data) => {
        const p = players.find(p => p.id === socket.id);
        if (p) io.emit('receiveMessage', { name: p.name, text: data.text });
    });

    socket.on('disconnect', () => {
        players = players.filter(p => p.id !== socket.id);
        io.emit('updatePlayerList', players);
    });
});

server.listen(3000);