const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.static('public'));

// المتغيرات
const rooms = new Map(); // { roomCode: { buzzerLocked: bool, players: [] } }

// نموذج الغرفة
function createRoom(roomCode) {
    return {
        roomCode,
        buzzerLocked: false,
        players: [],
        lastBuzzer: null
    };
}

// إضافة لاعب
function addPlayer(roomCode, socket) {
    if (!rooms.has(roomCode)) {
        rooms.set(roomCode, createRoom(roomCode));
    }
    
    const room = rooms.get(roomCode);
    room.players.push({
        id: socket.id,
        name: socket.playerName,
        team: socket.playerTeam,
        socketId: socket.id
    });
}

// حذف لاعب
function removePlayer(roomCode, socketId) {
    if (rooms.has(roomCode)) {
        const room = rooms.get(roomCode);
        room.players = room.players.filter(p => p.socketId !== socketId);
        
        if (room.players.length === 0) {
            rooms.delete(roomCode);
        }
    }
}

// Socket.io Events
io.on('connection', (socket) => {
    console.log(`New connection: ${socket.id}`);

    socket.on('join-room', (data) => {
        const { roomCode, name, team } = data;
        
        if (!roomCode || !name) {
            socket.emit('error', { message: 'Missing room code or name' });
            return;
        }

        // حفظ بيانات اللاعب
        socket.playerName = name;
        socket.playerTeam = team || 'team1';
        socket.currentRoom = roomCode;

        // الانضمام للغرفة
        socket.join(roomCode);
        addPlayer(roomCode, socket);

        const room = rooms.get(roomCode);
        const buzzerLocked = room ? room.buzzerLocked : false;

        // إرسال تأكيد للاعب
        socket.emit('joined', { 
            roomCode, 
            buzzerLocked,
            players: room.players 
        });

        // إخبار باقي اللاعبين
        socket.to(roomCode).emit('player-joined', {
            name,
            team,
            players: room.players
        });

        console.log(`${name} joined room ${roomCode}`);
    });

    socket.on('buzz', () => {
        const roomCode = socket.currentRoom;
        if (!roomCode) return;

        const room = rooms.get(roomCode);
        if (!room || room.buzzerLocked) return;

        // قفل الجرس
        room.buzzerLocked = true;
        room.lastBuzzer = {
            id: socket.id,
            name: socket.playerName,
            team: socket.playerTeam,
            time: new Date()
        };

        // إخبار جميع اللاعبين
        io.to(roomCode).emit('buzzed', {
            id: socket.id,
            name: socket.playerName,
            team: socket.playerTeam
        });

        console.log(`${socket.playerName} buzzed in room ${roomCode}`);
    });

    socket.on('reset', () => {
        const roomCode = socket.currentRoom;
        if (!roomCode) return;

        const room = rooms.get(roomCode);
        if (!room) return;

        // فتح الجرس
        room.buzzerLocked = false;
        room.lastBuzzer = null;

        // إخبار الجميع
        io.to(roomCode).emit('reset');
        console.log(`Buzzer reset in room ${roomCode}`);
    });

    socket.on('disconnect', () => {
        const roomCode = socket.currentRoom;
        if (roomCode) {
            removePlayer(roomCode, socket.id);
            io.to(roomCode).emit('player-left', {
                name: socket.playerName,
                players: rooms.get(roomCode)?.players || []
            });
        }
        console.log(`${socket.playerName} disconnected from ${roomCode}`);
    });

    socket.on('disconnect-announce', () => {
        socket.disconnect();
    });
});

// Routes
app.get('/health', (req, res) => {
    res.json({ status: 'Server is running', timestamp: new Date() });
});

app.get('/rooms', (req, res) => {
    const roomList = Array.from(rooms.entries()).map(([code, room]) => ({
        roomCode: code,
        playerCount: room.players.length,
        buzzerLocked: room.buzzerLocked
    }));
    res.json(roomList);
});

// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🎮 Buzzer Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
});
