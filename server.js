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
let actions = { protectedId: null, discoveredId: null };
let timer = null;
let gameLogs = []; // Oyun boyunca ne olduysa buraya yazılacak

io.on('connection', (socket) => {
    socket.on('joinGame', (username) => {
        if (!players.find(p => p.id === socket.id)) {
            players.push({ 
                id: socket.id, 
                name: username, 
                role: null, 
                alive: true, 
                points: 0, 
                isReady: false 
            });
        }
        io.emit('updatePlayerList', players);
    });

    // Chat ve Fısıldama Sistemi
    socket.on('sendMessage', (data) => {
        const p = players.find(p => p.id === socket.id);
        if (!p) return;

        if (data.targetId) { // Fısıldama (Özel Mesaj)
            const target = players.find(t => t.id === data.targetId);
            if (target) {
                io.to(target.id).emit('receiveMessage', { name: `(Fısıltı) ${p.name}`, text: data.text, color: '#a29bfe' });
                socket.emit('receiveMessage', { name: `(Fısıltı -> ${target.name})`, text: data.text, color: '#a29bfe' });
            }
        } else if (data.type === 'vampire' && p.role === 'Vampir') {
            players.filter(pl => pl.role === 'Vampir').forEach(v => {
                io.to(v.id).emit('receiveMessage', { name: `[VAMPİR KONSEYİ] ${p.name}`, text: data.text, color: '#ff4b5c' });
            });
        } else {
            io.emit('receiveMessage', { name: p.name, text: data.text, color: 'white' });
        }
    });

    socket.on('startGame', () => {
        if (players.length < 4) return; // Genişletilmiş roller için en az 4 kişi
        gameLogs = ["Oyun başladı! Roller dağıtıldı."];
        let pool = [...players];
        
        // Gelişmiş Rol Dağıtımı
        const roles = ['Vampir', 'Kahin', 'Doktor', 'Seri Katil']; // Seri Katil herkesi öldürmeye çalışır
        
        // Karıştır ve ata
        pool.sort(() => Math.random() - 0.5);
        players.forEach((p, idx) => {
            p.alive = true;
            if (idx === 0) p.role = 'Vampir';
            else if (idx === 1) p.role = 'Kahin';
            else if (idx === 2) p.role = 'Doktor';
            else if (idx === 3 && players.length > 5) p.role = 'Seri Katil';
            else p.role = 'Köylü';
            io.to(p.id).emit('assignRole', p.role);
        });
        
        startNight();
    });

    function startNight() {
        gameState = "night";
        votes = {};
        actions = { protectedId: null };
        io.emit('gameUpdate', { state: "night", message: "🌙 Gece Çöküyor... Roller yeteneklerini seçsin.", players });
    }

    // Gece Yetenekleri
    socket.on('nightAction', (data) => {
        const p = players.find(p => p.id === socket.id);
        if (!p || !p.alive || gameState !== "night") return;

        if (p.role === 'Vampir') {
            actions.vampireTarget = data.targetId;
            socket.emit('announcement', "Hedef belirlendi.");
        } else if (p.role === 'Doktor') {
            actions.protectedId = data.targetId;
            socket.emit('announcement', "Oyuncuyu korumaya aldın.");
        } else if (p.role === 'Kahin') {
            const target = players.find(t => t.id === data.targetId);
            socket.emit('announcement', `🔮 Görü: ${target.name} bir ${target.role}!`);
        }
        
        // Tüm roller seçim yapınca gündüze geç (Basitlik için 5sn sonra geçiyoruz)
    });

    // Gece Bitimi ve Gündüz Başlangıcı
    socket.on('finishNight', () => {
        if (gameState !== "night") return;
        let killNews = "🏥 Gece sakin geçti, kimse ölmedi.";
        
        if (actions.vampireTarget && actions.vampireTarget !== actions.protectedId) {
            const victim = players.find(v => v.id === actions.vampireTarget);
            if (victim) {
                victim.alive = false;
                killNews = `💀 ${victim.name} dün gece parçalanmış halde bulundu!`;
                gameLogs.push(killNews);
            }
        } else if (actions.vampireTarget === actions.protectedId) {
            killNews = "🛡️ Vampir saldırdı ama Doktor kurbanı kurtardı!";
            gameLogs.push(killNews);
        }

        startDay(killNews);
    });

    function startDay(news) {
        if (checkGameOver()) return;
        gameState = "day";
        votes = {};
        io.emit('gameUpdate', { state: "day", message: news, players });
        
        let timeLeft = 60;
        if (timer) clearInterval(timer);
        timer = setInterval(() => {
            timeLeft--;
            io.emit('timerUpdate', timeLeft);
            if (timeLeft <= 0) { clearInterval(timer); tallyVotes(); }
        }, 1000);
    }

    socket.on('castVote', (targetId) => {
        if (gameState !== "day") return;
        votes[socket.id] = targetId;
        const aliveCount = players.filter(p => p.alive).length;
        if (Object.keys(votes).length >= aliveCount) {
            clearInterval(timer);
            tallyVotes();
        }
    });

    function tallyVotes() {
        const counts = {};
        Object.values(votes).forEach(id => counts[id] = (counts[id] || 0) + 1);
        const lynchedId = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b, null);
        
        const victim = players.find(v => v.id === lynchedId);
        if (victim) {
            victim.alive = false;
            const msg = `📢 Köy halkı ${victim.name} adlı kişinin ipini çekti!`;
            io.emit('announcement', msg);
            gameLogs.push(msg);
        }
        
        if (!checkGameOver()) setTimeout(startNight, 4000);
    }

    function checkGameOver() {
        const vamps = players.filter(p => p.role === 'Vampir' && p.alive);
        const citizens = players.filter(p => p.role !== 'Vampir' && p.alive);
        
        let winner = null;
        if (vamps.length === 0) winner = "KÖYLÜLER";
        else if (vamps.length >= citizens.length) winner = "VAMPİRLER";

        if (winner) {
            io.emit('gameOver', { 
                winner, 
                logs: gameLogs, 
                stats: players.map(p => ({ name: p.name, role: p.role })) 
            });
            setTimeout(() => {
                players.forEach(p => { p.alive = true; p.role = null; });
                io.emit('reload');
            }, 10000);
            return true;
        }
        return false;
    }

    socket.on('disconnect', () => {
        players = players.filter(p => p.id !== socket.id);
        io.emit('updatePlayerList', players);
    });
});

server.listen(3000, () => console.log('Pro Server Active'));