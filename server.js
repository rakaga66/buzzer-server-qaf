const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);

app.use(cors());
// Serve the mobile buzzer client from the public folder
app.use(express.static(path.join(__dirname, 'public')));

// Configure Socket.io with broad CORS for local LAN networking
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

let roomLocks = {}; // Tracks if a room's buzzer is restricted

io.on('connection', (socket) => {
    console.log('Player/Host connected:', socket.id);

    // Host (main game screen) joins
    socket.on('host-join', (roomCode) => {
        socket.join(roomCode);
        roomLocks[roomCode] = false;
        console.log(`Host established room: ${roomCode}`);
    });

    // Mobile client joins (Updated to match user's 'join-room' event)
    socket.on('join-room', (data) => {
        const { roomCode, name, team } = data;
        socket.join(roomCode);
        socket.emit('joined', { buzzerLocked: roomLocks[roomCode] || false });
        console.log(`Player ${name} (${team}) joined room: ${roomCode}`);
    });

    // Mobile client press buzzer
    socket.on('buzz', (data) => {
        // Find which room this socket belongs to if data is incomplete
        // But the user's client already simplifies this
        const room = Object.keys(socket.rooms).find(r => r !== socket.id);
        if (!room || roomLocks[room]) return;

        roomLocks[room] = true;
        
        // Broadcast to everyone in the room (including host and players)
        // Adding 'id' to let the buzzer know if they were the first
        io.to(room).emit('buzzed', { 
            id: socket.id, 
            name: data?.name || 'مجهول', 
            team: data?.team || 'team1' 
        });
        console.log(`BUZZ! in Room: ${room}`);
    });

    // Free the buzzer (Updated to match user's 'reset' event)
    socket.on('unlock-buzzer', (roomCode) => {
        roomLocks[roomCode] = false;
        io.to(roomCode).emit('reset');
        console.log(`Buzzer reset for room: ${roomCode}`);
    });

    // Handle team timeout
    socket.on('team-timeout', (data) => {
        const { roomCode, timedOutTeam, team1Name, team2Name, isFinal } = data;

        if (isFinal) {
            roomLocks[roomCode] = false;
            io.to(roomCode).emit('reset');
            return;
        }

        const nextTeam = (timedOutTeam === 'team1') ? 'team2' : 'team1';
        const nextTeamName = (nextTeam === 'team1') ? team1Name : team2Name;
        io.to(roomCode).emit('switch-team', { nextTeam, nextTeamName });
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Buzzer Server running on port ${PORT}.`);
});
