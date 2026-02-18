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
let gameLogs = [];
let totalTasksCompleted = 0;

// Rastgele görev havuzu
const taskPool = [
    "Kuyudan su çek", "Odunları istifle", "Köy kapısını kilitle", 
    "Gümüş mermileri parlat", "Kutsal suyu tazele", "Eski parşömenleri oku"
];

io.on('connection', (socket) => {
    socket.on('joinGame', (username) => {
        if (!players.find(p => p.id === socket.id)) {
            players.push({ 
                id: socket.id, name: username, role: null, 
                alive: true, tasks: [], completedTasks: 0 
            });
        }
        io.emit('updatePlayerList', players);
    });

    socket.on('sendMessage', (data) => {
        const p = players.find(p => p.id === socket.id);
        if (!p) return;
        if (data.type === 'vampire' && p.role === 'Vampir') {
            players.filter(pl => pl.role === 'Vampir').forEach(v => {
                io.to(v.id).emit('receiveMessage', { name: `[VAMPİR] ${p.name}`, text: data.text, color: '#ff4b5c' });
            });
        } else {
            io.emit('receiveMessage', { name: p.name, text: data.text, color: 'white' });
        }
    });

    socket.on('startGame', () => {
        if (players.length < 3) return;
        gameLogs = ["Oyun başladı! Görevler dağıtıldı."];
        totalTasksCompleted = 0;
        let pool = [...players];
        pool.sort(() => Math.random() - 0.5);

        players.forEach((p, idx) => {
            p.alive = true;
            p.completedTasks = 0;
            // Görev Ata
            p.tasks = [...taskPool].sort(() => Math.random() - 0.5).slice(0, 3);
            
            if (idx === 0) p.role = 'Vampir';
            else if (idx === 1) p.role = 'Kahin';
            else if (idx === 2) p.role = 'Doktor';
            else p.role = 'Köylü';
            
            io.to(p.id).emit('assignRole', { role: p.role, tasks: p.tasks });
        });
        startNight();
    });

    // GÖREV TAMAMLAMA SİSTEMİ
    socket.on('completeTask', (taskName) => {
        const p = players.find(p => p.id === socket.id);
        if (p && p.alive && p.tasks.includes(taskName)) {
            p.tasks = p.tasks.filter(t => t !== taskName);
            p.completedTasks++;
            totalTasksCompleted++;
            
            io.emit('taskGlobalUpdate', { 
                total: totalTasksCompleted, 
                msg: `🛠️ ${p.name} bir görev tamamladı!` 
            });

            // ÖDÜL: Eğer toplamda 5 görev biterse vampir hakkında ipucu ver (Rastgele birinin köylü olduğunu açıkla)
            if (totalTasksCompleted % 5 === 0) {
                const innocent = players.find(pl => pl.role !== 'Vampir' && pl.alive);
                io.emit('announcement', `✨ Köyün birliği güçleniyor! İpucu: ${innocent.name} kesinlikle masum.`);
            }
        }
    });

    function startNight() {
        gameState = "night";
        actions = { protectedId: null, vampireTarget: null };
        io.emit('gameUpdate', { state: "night", message: "🌙 Gece... Vampir avlanıyor, köylüler saklanıyor.", players });
    }

    socket.on('nightAction', (data) => {
        const p = players.find(p => p.id === socket.id);
        if (!p || !p.alive || gameState !== "night") return;
        if (p.role === 'Vampir') actions.vampireTarget = data.targetId;
        if (p.role === 'Doktor') actions.protectedId = data.targetId;
        if (p.role === 'Kahin') {
            const t = players.find(t => t.id === data.targetId);
            socket.emit('announcement', `🔮 Görü: ${t.name} bir ${t.role}!`);
        }
    });

    socket.on('finishNight', () => {
        let news = "🏥 Gece sakin geçti.";
        if (actions.vampireTarget && actions.vampireTarget !== actions.protectedId) {
            const victim = players.find(v => v.id === actions.vampireTarget);
            if (victim) { victim.alive = false; news = `💀 ${victim.name} gece kurban edildi!`; }
        }
        startDay(news);
    });

    function startDay(news) {
        if (checkGameOver()) return;
        gameState = "day";
        io.emit('gameUpdate', { state: "day", message: news, players });
        let timeLeft = 45;
        if (timer) clearInterval(timer);
        timer = setInterval(() => {
            timeLeft--;
            io.emit('timerUpdate', timeLeft);
            if (timeLeft <= 0) { clearInterval(timer); tallyVotes(); }
        }, 1000);
    }

    socket.on('castVote', (id) => {
        votes[socket.id] = id;
        if (Object.keys(votes).length >= players.filter(p => p.alive).length) {
            clearInterval(timer);
            tallyVotes();
        }
    });

    function tallyVotes() {
        const counts = {};
        Object.values(votes).forEach(id => counts[id] = (counts[id] || 0) + 1);
        const lynchedId = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b, null);
        const victim = players.find(v => v.id === lynchedId);
        if (victim) { victim.alive = false; io.emit('announcement', `📢 Köylüler ${victim.name}'i astı!`); }
        votes = {};
        if (!checkGameOver()) setTimeout(startNight, 4000);
    }

    function checkGameOver() {
        const v = players.filter(p => p.role === 'Vampir' && p.alive);
        const c = players.filter(p => p.role !== 'Vampir' && p.alive);
        let winner = v.length === 0 ? "KÖYLÜLER" : (v.length >= c.length ? "VAMPİRLER" : null);
        if (winner) { io.emit('gameOver', { winner }); return true; }
        return false;
    }
});

server.listen(3000);