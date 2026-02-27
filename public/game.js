const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    parent: 'game-container',
    physics: { default: 'arcade', arcade: { gravity: { y: 0 } } },
    scene: { preload: preload, create: create, update: update }
};

const game = new Phaser.Game(config);
let socket;
let otherPlayers; // Phaser Group
let playerContainer; // Senin karakterin + ismi
let cursors;
let uiContainer; // Oylama Paneli vb.

function preload() {
    this.load.image('ground', 'assets/grass.png');
    this.load.spritesheet('dude', 'assets/dude.png', { frameWidth: 32, frameHeight: 48 });
}

function create() {
    socket = io(); // Sunucuya bağlan
    this.add.tileSprite(400, 300, 800, 600, 'ground');
    
    // Diğer oyuncular için bir grup oluştur
    otherPlayers = this.physics.add.group();

    // -- Socket Olayları --

    // 1. Mevcut Oyuncuları Çiz
    socket.on('currentPlayers', (players) => {
        Object.keys(players).forEach((id) => {
            if (id === socket.id) {
                // Kendi karakterini oluştur (İsim Etiketi ile)
                addPlayer(this, players[id]);
            } else {
                // Diğer oyuncuları ekle
                addOtherPlayers(this, players[id]);
            }
        });
    });

    // 2. Yeni Oyuncu Katıldı
    socket.on('newPlayer', (playerInfo) => {
        addOtherPlayers(this, playerInfo);
    });

    // 3. Diğer Oyuncu Hareket Etti
    socket.on('playerMoved', (playerInfo) => {
        otherPlayers.getChildren().forEach((otherPlayer) => {
            if (playerInfo.id === otherPlayer.playerId) {
                otherPlayer.setPosition(playerInfo.x, playerInfo.y);
                // İsmi de hareket ettir (Eğer varsa)
                if (otherPlayer.nameText) otherPlayer.nameText.setPosition(playerInfo.x, playerInfo.y - 30);
            }
        });
    });

    // 4. Oyuncu Ayrıldı
    socket.on('playerDisconnected', (playerId) => {
        otherPlayers.getChildren().forEach((otherPlayer) => {
            if (playerId === otherPlayer.playerId) {
                if (otherPlayer.nameText) otherPlayer.nameText.destroy();
                otherPlayer.destroy();
            }
        });
    });

    // 5. Gece/Gündüz Döngüsü
    socket.on('gameStateChanged', (newState) => {
        // Atmosferi değiştir (Tinting)
        this.children.getChildren().forEach((child) => {
            if (child.type === 'TileSprite' || child.type === 'Sprite') {
                child.setTint(newState === 'NIGHT' ? 0x3333ff : 0xffffff);
            }
        });
    });

    // -- Kontroller --
    cursors = this.input.keyboard.createCursorKeys();
}

function update() {
    if (playerContainer) {
        // Hareket Mantığı
        playerContainer.body.setVelocity(0);
        let moved = false;

        if (cursors.left.isDown) {
            playerContainer.body.setVelocityX(-160);
            moved = true;
        } else if (cursors.right.isDown) {
            playerContainer.body.setVelocityX(160);
            moved = true;
        }

        if (cursors.up.isDown) {
            playerContainer.body.setVelocityY(-160);
            moved = true;
        } else if (cursors.down.isDown) {
            playerContainer.body.setVelocityY(160);
            moved = true;
        }

        // Hareketi Sunucuya Bildir
        if (moved) {
            socket.emit('playerMovement', { x: playerContainer.x, y: playerContainer.y });
        }
    }
}

// -- Yardımcı Fonksiyonlar --

function addPlayer(scene, playerInfo) {
    // Kendi karakterimiz: Sprite + İsim Etiketi
    const sprite = scene.add.sprite(0, 0, 'dude').setTint(0xff0000); // Kendimizi kırmızı yapalım
    const label = scene.add.text(0, -30, playerInfo.username, { fontSize: '14px', fill: '#fff' }).setOrigin(0.5);
    
    // Container kullanarak ikisini birleştiriyoruz
    playerContainer = scene.add.container(playerInfo.x, playerInfo.y, [sprite, label]);
    scene.physics.world.enable(playerContainer);
    playerContainer.body.setCollideWorldBounds(true);
}

function addOtherPlayers(scene, playerInfo) {
    const otherPlayer = scene.physics.add.sprite(playerInfo.x, playerInfo.y, 'dude');
    otherPlayer.playerId = playerInfo.id;
    
    // İsim Etiketi (Basitlik için sprite'ın üzerine text ekliyoruz)
    otherPlayer.nameText = scene.add.text(playerInfo.x, playerInfo.y - 30, playerInfo.username, { fontSize: '14px', fill: '#fff' }).setOrigin(0.5);
    
    otherPlayers.add(otherPlayer);
}