// Ladd.io Multiplayer Server
// Real-time multiplayer with WebSocket (Socket.io)

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        players: Object.keys(players).length,
        uptime: process.uptime()
    });
});

// Game constants
const WORLD_WIDTH = 4000;
const WORLD_HEIGHT = 4000;
const INITIAL_LENGTH = 10;
const SEGMENT_SIZE = 12;
const FOOD_COUNT = 500;
const TICK_RATE = 30; // 30 FPS

// Game state
let players = {};
let food = [];
let gameLoopInterval = null;

// Initialize food
function spawnFood() {
    return {
        id: Math.random().toString(36).substr(2, 9),
        x: Math.random() * WORLD_WIDTH,
        y: Math.random() * WORLD_HEIGHT,
        color: `hsl(${Math.random() * 360}, 70%, 50%)`
    };
}

console.log('🍎 Spawning initial food...');
for (let i = 0; i < FOOD_COUNT; i++) {
    food.push(spawnFood());
}
console.log(`✅ ${FOOD_COUNT} food items spawned`);

// Handle connections
io.on('connection', (socket) => {
    console.log(`\n🔌 New connection: ${socket.id}`);
    console.log(`👥 Total connections: ${Object.keys(players).length + 1}`);

    // Player joins
    socket.on('join', (data) => {
        console.log(`\n🎮 Player joining...`);
        console.log(`   Name: ${data.name || 'Unnamed'}`);
        console.log(`   Socket ID: ${socket.id}`);
        
        const player = {
            id: socket.id,
            name: (data.name || 'Unnamed').substring(0, 15), // Limit name length
            x: Math.random() * (WORLD_WIDTH - 200) + 100,
            y: Math.random() * (WORLD_HEIGHT - 200) + 100,
            angle: Math.random() * Math.PI * 2,
            segments: [],
            color: data.color || `hsl(${Math.random() * 360}, 70%, 50%)`,
            headColor: data.color ? data.color.replace('50%', '60%') : `hsl(${Math.random() * 360}, 70%, 60%)`,
            alive: true,
            score: 0,
            kills: 0,
            boosting: false
        };

        // Initialize segments with proper spacing
        for (let i = 0; i < INITIAL_LENGTH; i++) {
            player.segments.push({
                x: player.x - i * SEGMENT_SIZE * 1.5,
                y: player.y
            });
        }

        players[socket.id] = player;

        // Send initial game state to new player
        socket.emit('init', {
            playerId: socket.id,
            player: player,
            players: players,
            food: food,
            worldSize: { width: WORLD_WIDTH, height: WORLD_HEIGHT }
        });

        // Notify all other players
        socket.broadcast.emit('playerJoined', player);

        console.log(`✅ ${data.name} joined the game`);
        console.log(`   Position: (${Math.floor(player.x)}, ${Math.floor(player.y)})`);
        console.log(`   Total players: ${Object.keys(players).length}`);
    });

    // Player movement update
    socket.on('move', (data) => {
        if (players[socket.id] && players[socket.id].alive) {
            const player = players[socket.id];
            player.angle = data.angle;
            player.x = data.x;
            player.y = data.y;
            player.segments = data.segments;
            player.score = data.segments.length;
        }
    });

    // Player boosting
    socket.on('boost', (data) => {
        if (players[socket.id]) {
            players[socket.id].boosting = data.boosting;
        }
    });

    // Food eaten
    socket.on('eatFood', (foodId) => {
        // Remove food and spawn new one
        const index = food.findIndex(f => f.id === foodId);
        if (index !== -1) {
            food.splice(index, 1);
            const newFood = spawnFood();
            food.push(newFood);
            
            // Broadcast to all players
            io.emit('foodEaten', { foodId, newFood });
        }
    });

    // Player died
    socket.on('died', (data) => {
        const player = players[socket.id];
        if (player) {
            player.alive = false;
            
            console.log(`\n💀 ${player.name} died`);
            if (data.killedBy && players[data.killedBy]) {
                console.log(`   Killed by: ${players[data.killedBy].name}`);
                players[data.killedBy].kills++;
            }
            console.log(`   Final length: ${player.segments.length}`);
            
            // Drop food where player died
            const dropFood = [];
            const dropCount = Math.min(player.segments.length, 50);
            for (let i = 0; i < dropCount; i++) {
                const seg = player.segments[Math.floor(Math.random() * player.segments.length)];
                const newFood = {
                    id: Math.random().toString(36).substr(2, 9),
                    x: seg.x + (Math.random() - 0.5) * 50,
                    y: seg.y + (Math.random() - 0.5) * 50,
                    color: player.color
                };
                food.push(newFood);
                dropFood.push(newFood);
            }
            
            // Notify all players
            io.emit('playerDied', {
                playerId: socket.id,
                killedBy: data.killedBy,
                dropFood: dropFood
            });
        }
    });

    // Player respawn
    socket.on('respawn', (data) => {
        const player = players[socket.id];
        if (player) {
            player.x = Math.random() * (WORLD_WIDTH - 200) + 100;
            player.y = Math.random() * (WORLD_HEIGHT - 200) + 100;
            player.angle = Math.random() * Math.PI * 2;
            player.segments = [];
            player.alive = true;
            player.score = 0;
            
            for (let i = 0; i < INITIAL_LENGTH; i++) {
                player.segments.push({
                    x: player.x - i * SEGMENT_SIZE * 1.5,
                    y: player.y
                });
            }
            
            // Notify all players
            io.emit('playerRespawned', player);
            console.log(`\n🔄 ${player.name} respawned`);
        }
    });

    // Disconnect
    socket.on('disconnect', () => {
        if (players[socket.id]) {
            console.log(`\n👋 ${players[socket.id].name} disconnected`);
            console.log(`   Remaining players: ${Object.keys(players).length - 1}`);
            delete players[socket.id];
            io.emit('playerLeft', socket.id);
        }
    });

    // Handle errors
    socket.on('error', (error) => {
        console.error(`❌ Socket error for ${socket.id}:`, error);
    });
});

// Game loop - broadcast state to all clients
function gameLoop() {
    // Calculate leaderboard
    const leaderboard = Object.values(players)
        .filter(p => p.alive)
        .sort((a, b) => b.segments.length - a.segments.length)
        .slice(0, 10)
        .map(p => ({
            id: p.id,
            name: p.name,
            score: p.segments.length,
            kills: p.kills
        }));

    // Broadcast game state (only essential data to reduce bandwidth)
    io.emit('gameState', {
        players: Object.fromEntries(
            Object.entries(players).map(([id, p]) => [
                id,
                {
                    id: p.id,
                    name: p.name,
                    x: p.x,
                    y: p.y,
                    angle: p.angle,
                    segments: p.segments,
                    color: p.color,
                    headColor: p.headColor,
                    alive: p.alive,
                    boosting: p.boosting
                }
            ])
        ),
        leaderboard: leaderboard
    });
}

// Start game loop
gameLoopInterval = setInterval(gameLoop, 1000 / TICK_RATE);

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('\n🛑 SIGTERM received, shutting down gracefully...');
    clearInterval(gameLoopInterval);
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('\n🛑 SIGINT received, shutting down gracefully...');
    clearInterval(gameLoopInterval);
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('\n========================================');
    console.log('🐍  LADD.IO MULTIPLAYER SERVER');
    console.log('========================================');
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Local: http://localhost:${PORT}`);
    console.log(`📡 WebSocket server ready`);
    console.log(`🍎 Food items: ${food.length}`);
    console.log(`🎮 Tick rate: ${TICK_RATE} FPS`);
    console.log(`🗺️  World size: ${WORLD_WIDTH}x${WORLD_HEIGHT}`);
    console.log('========================================\n');
    console.log('⏳ Waiting for players to connect...\n');
});
