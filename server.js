const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let players = [];
let gameState = "waiting"; // waiting, night, day
let votes = {}; // Oyları takip etmek için

io.on('connection', (socket) => {
    console.log('Bir oyuncu bağlandı:', socket.id);

    // OYUNA KATILMA
    socket.on('joinGame', (username) => {
        const exists = players.find(p => p.id === socket.id);
        if (!exists) {
            players.push({ id: socket.id, name: username, role: null, alive: true });
        }
        io.emit('updatePlayerList', players);
    });

    // OYUNU BAŞLATMA
    socket.on('startGame', () => {
        if (players.length < 2) return; 
        
        // Rolleri Dağıt (1 Vampir, Gerisi Köylü)
        const vampireIndex = Math.floor(Math.random() * players.length);
        players.forEach((p, i) => {
            p.role = (i === vampireIndex) ? 'Vampir' : 'Köylü';
            p.alive = true;
            io.to(p.id).emit('assignRole', p.role);
        });

        startNight();
    });

    // GECE DÖNGÜSÜ
    function startNight() {
        gameState = "night";
        votes = {}; // Oyları sıfırla
        io.emit('gameUpdate', { 
            state: "night", 
            message: "🌙 Gece oldu... Vampir bir kurban seçiyor!", 
            players: players 
        });
    }

    // VAMPİR SALDIRISI
    socket.on('vampireAction', (targetId) => {
        const attacker = players.find(p => p.id === socket.id);
        if (gameState === "night" && attacker && attacker.role === 'Vampir' && attacker.alive) {
            const victim = players.find(p => p.id === targetId);
            if (victim && victim.alive) {
                victim.alive = false;
                startDay(`${victim.name} dün gece saldırıya uğradı ve öldü! 💀`);
            }
        }
    });

    // GÜNDÜZ DÖNGÜSÜ
    function startDay(news) {
        if (checkGameOver()) return;

        gameState = "day";
        io.emit('gameUpdate', { 
            state: "day", 
            message: `☀️ Sabah oldu! ${news} Şimdi oylama vakti.`, 
            players: players 
        });
    }

    // OYLAMA SİSTEMİ
    socket.on('castVote', (targetId) => {
        if (gameState === "day") {
            const voter = players.find(p => p.id === socket.id);
            if (voter && voter.alive) {
                votes[socket.id] = targetId;
                
                const alivePlayers = players.filter(p => p.alive);
                // Herkes oy verince sonuçları açıkla
                if (Object.keys(votes).length >= alivePlayers.length) {
                    tallyVotes();
                }
            }
        }
    });

    function tallyVotes() {
        const voteCounts = {};
        Object.values(votes).forEach(id => {
            voteCounts[id] = (voteCounts[id] || 0) + 1;
        });

        // En çok oy alanı bul
        let lynchedId = Object.keys(voteCounts).reduce((a, b) => voteCounts[a] > voteCounts[b] ? a : b, null);
        const victim = players.find(p => p.id === lynchedId);

        if (victim) {
            victim.alive = false;
            io.emit('announcement', `📢 Köy kararıyla ${victim.name} asıldı!`);
        }

        if (!checkGameOver()) {
            setTimeout(startNight, 3000); // 3 saniye sonra geceye geç
        }
    }

    // OYUN BİTİŞ KONTROLÜ
    function checkGameOver() {
        const vamps = players.filter(p => p.role === 'Vampir' && p.alive);
        const citizens = players.filter(p => p.role === 'Köylü' && p.alive);

        if (vamps.length === 0) {
            io.emit('announcement', "🎉 KÖYLÜLER KAZANDI! Vampir yok edildi.");
            resetGame();
            return true;
        } else if (vamps.length >= citizens.length) {
            io.emit('announcement', "🧛 VAMPİR KAZANDI! Köyü ele geçirdi.");
            resetGame();
            return true;
        }
        return false;
    }

    function resetGame() {
        gameState = "waiting";
        players.forEach(p => { p.role = null; p.alive = true; });
        io.emit('updatePlayerList', players);
    }

    socket.on('disconnect', () => {
        players = players.filter(p => p.id !== socket.id);
        io.emit('updatePlayerList', players);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Sunucu ${PORT} portunda başarıyla başlatıldı!`);
});