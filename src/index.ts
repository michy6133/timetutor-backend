import 'dotenv/config';
import http from 'http';
import { Server as SocketServer } from 'socket.io';
import app from './app';

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

// Socket.io — temps réel créneaux
const io = new SocketServer(server, {
  cors: { origin: process.env.FRONTEND_URL }
});

io.on('connection', (socket) => {
  console.log(`Socket connecté : ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`Socket déconnecté : ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 TimeTutor API démarrée sur http://localhost:${PORT}`);
});