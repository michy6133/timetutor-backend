import type { Server, Socket } from 'socket.io';

export function setupSocketHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    console.log(`[WS] Connecté: ${socket.id}`);

    // Teacher or Director joins a session room to receive real-time updates
    socket.on('join-session', (sessionId: string) => {
      socket.join(`session:${sessionId}`);
      console.log(`[WS] ${socket.id} rejoint session:${sessionId}`);
    });

    socket.on('leave-session', (sessionId: string) => {
      socket.leave(`session:${sessionId}`);
    });

    socket.on('disconnect', () => {
      console.log(`[WS] Déconnecté: ${socket.id}`);
    });
  });
}

// Emit helpers called from controllers
export function emitSlotSelected(
  io: Server,
  sessionId: string,
  payload: { slotId: string; teacherName: string; status: string }
): void {
  io.to(`session:${sessionId}`).emit('slot-selected', payload);
}

export function emitSlotReleased(io: Server, sessionId: string, slotId: string): void {
  io.to(`session:${sessionId}`).emit('slot-released', { slotId });
}

export function emitSlotValidated(io: Server, sessionId: string, slotId: string): void {
  io.to(`session:${sessionId}`).emit('slot-validated', { slotId });
}

export function emitContactRequest(
  io: Server,
  sessionId: string,
  payload: { slotId: string; requesterName: string }
): void {
  io.to(`session:${sessionId}`).emit('contact-request', payload);
}
