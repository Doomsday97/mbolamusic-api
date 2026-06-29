// Tests for chat controller – validates request logic without a real DB
// We mock @prisma/client so no database connection is required.

jest.mock('@prisma/client', () => {
  const msgs = [];
  const PrismaClient = jest.fn().mockImplementation(() => ({
    chatMessage: {
      findMany:   jest.fn().mockResolvedValue(msgs),
      create:     jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({ id: 'msg-1', ...data, createdAt: new Date() })),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      count:      jest.fn().mockResolvedValue(2),
      groupBy:    jest.fn().mockResolvedValue([]),
      findFirst:  jest.fn().mockResolvedValue(null),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'user-1', username: 'testUser', email: 'test@test.com', role: 'LISTENER',
      }),
    },
    notification: {
      create: jest.fn().mockResolvedValue({ id: 'notif-1' }),
    },
  }));
  return { PrismaClient };
});

const chat = require('../src/controllers/chatController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}

describe('Chat Controller', () => {
  describe('sendMessage', () => {
    test('rechaza mensaje vacío con 400', async () => {
      const req = { user: { id: 'user-1' }, body: { body: '' } };
      const res = mockRes();
      await chat.sendMessage(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false }),
      );
    });

    test('rechaza mensaje solo espacios con 400', async () => {
      const req = { user: { id: 'user-1' }, body: { body: '   ' } };
      const res = mockRes();
      await chat.sendMessage(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('acepta mensaje válido y devuelve success', async () => {
      const req = { user: { id: 'user-1' }, body: { body: 'Hola, necesito ayuda' } };
      const res = mockRes();
      await chat.sendMessage(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true }),
      );
    });

    test('mensaje creado tiene fromAdmin=false', async () => {
      const req = { user: { id: 'user-1' }, body: { body: 'Consulta de prueba' } };
      const res = mockRes();
      await chat.sendMessage(req, res);
      const call = res.json.mock.calls[0][0];
      expect(call.data.fromAdmin).toBe(false);
    });
  });

  describe('adminSendMessage', () => {
    test('rechaza mensaje vacío con 400', async () => {
      const req = { params: { userId: 'user-1' }, body: { body: '' } };
      const res = mockRes();
      await chat.adminSendMessage(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('acepta respuesta del admin y crea notificación', async () => {
      const req = { params: { userId: 'user-1' }, body: { body: 'Tu problema está resuelto' } };
      const res = mockRes();
      await chat.adminSendMessage(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true }),
      );
      const call = res.json.mock.calls[0][0];
      expect(call.data.fromAdmin).toBe(true);
    });

    test('mensaje admin tiene fromAdmin=true', async () => {
      const req = { params: { userId: 'user-1' }, body: { body: 'Respuesta del equipo' } };
      const res = mockRes();
      await chat.adminSendMessage(req, res);
      const call = res.json.mock.calls[0][0];
      expect(call.data.fromAdmin).toBe(true);
    });
  });

  describe('unreadCount', () => {
    test('devuelve conteo de mensajes no leídos', async () => {
      const req = { user: { id: 'user-1' } };
      const res = mockRes();
      await chat.unreadCount(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: { count: 2 } }),
      );
    });
  });

  describe('getMyMessages', () => {
    test('devuelve array de mensajes', async () => {
      const req = { user: { id: 'user-1' } };
      const res = mockRes();
      await chat.getMyMessages(req, res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true }),
      );
      expect(Array.isArray(res.json.mock.calls[0][0].data)).toBe(true);
    });
  });
});
