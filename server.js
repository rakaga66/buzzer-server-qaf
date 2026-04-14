const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// roomLocks  → هل الجرس مقفول في هذه الغرفة
// roomPlayers → قائمة اللاعبين المتصلين في كل غرفة
let roomLocks   = {};
let roomPlayers = {}; // { roomCode: { socketId: { name, team } } }

// ── مساعد: تنظيف غرفة لو ما فيها أحد ──────────────────────────────────────
function cleanRoomIfEmpty(roomCode) {
    const room = io.sockets.adapter.rooms.get(roomCode);
    if (!room || room.size === 0) {
        delete roomLocks[roomCode];
        delete roomPlayers[roomCode];
        console.log(`Room ${roomCode} cleaned up (empty).`);
    }
}

io.on('connection', (socket) => {
    console.log('Connected:', socket.id);

    // ── الهوست يفتح الغرفة ────────────────────────────────────────────────
    socket.on('host-join', (roomCode) => {
        socket.join(roomCode);
        roomLocks[roomCode]   = false;
        roomPlayers[roomCode] = roomPlayers[roomCode] || {};
        console.log(`Host opened room: ${roomCode}`);
    });

    // ── لاعب يدخل الغرفة ─────────────────────────────────────────────────
    socket.on('join-room', (data) => {
        const { roomCode, name, team } = data;
        if (!roomCode || !name) return;

        socket.join(roomCode);

        // احفظ بيانات اللاعب
        if (!roomPlayers[roomCode]) roomPlayers[roomCode] = {};
        roomPlayers[roomCode][socket.id] = { name, team };

        // أبلغ اللاعب بحالة الجرس الحالية
        socket.emit('joined', { buzzerLocked: roomLocks[roomCode] || false });

        // أبلغ الهوست بعدد اللاعبين
        const count = Object.keys(roomPlayers[roomCode]).length;
        io.to(roomCode).emit('player-count', { count });

        console.log(`Player "${name}" (${team}) joined room: ${roomCode} — total: ${count}`);
    });

    // ── لاعب يضغط الجرس ──────────────────────────────────────────────────
    socket.on('buzz', (data) => {
        const room = [...socket.rooms].find(r => r !== socket.id);
        if (!room || roomLocks[room]) return;

        roomLocks[room] = true;

        // استخدم البيانات المُرسلة أو ارجع للمحفوظة في roomPlayers
        const saved = roomPlayers[room]?.[socket.id] || {};
        const name  = data?.name  || saved.name  || 'مجهول';
        const team  = data?.team  || saved.team  || 'team1';

        io.to(room).emit('buzzed', { id: socket.id, name, team });
        console.log(`BUZZ! "${name}" in room: ${room}`);
    });

    // ── فك قفل الجرس (من الهوست) ─────────────────────────────────────────
    socket.on('unlock-buzzer', (roomCode) => {
        roomLocks[roomCode] = false;
        io.to(roomCode).emit('reset');
        console.log(`Buzzer unlocked in room: ${roomCode}`);
    });

    // ── انتهاء وقت فريق ──────────────────────────────────────────────────
    socket.on('team-timeout', (data) => {
        const { roomCode, timedOutTeam, team1Name, team2Name, isFinal } = data;

        if (isFinal) {
            roomLocks[roomCode] = false;
            io.to(roomCode).emit('reset');
            return;
        }

        const nextTeam     = timedOutTeam === 'team1' ? 'team2' : 'team1';
        const nextTeamName = nextTeam     === 'team1' ? team1Name : team2Name;
        io.to(roomCode).emit('switch-team', { nextTeam, nextTeamName });
    });

    // ── انقطاع اتصال اللاعب ──────────────────────────────────────────────
    socket.on('disconnect', () => {
        console.log('Disconnected:', socket.id);

        // احذف اللاعب من كل غرفة كان فيها
        for (const roomCode of Object.keys(roomPlayers)) {
            if (roomPlayers[roomCode]?.[socket.id]) {
                delete roomPlayers[roomCode][socket.id];

                const count = Object.keys(roomPlayers[roomCode]).length;
                io.to(roomCode).emit('player-count', { count });

                cleanRoomIfEmpty(roomCode);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Buzzer Server running on port ${PORT}`);
});
