// Tests for security-questions validation logic in authController
// Mocks Prisma and bcrypt so no database or real hashing is needed.

jest.mock('bcryptjs', () => ({
  hash:    jest.fn().mockResolvedValue('$hashed$'),
  compare: jest.fn().mockResolvedValue(true),
}));

jest.mock('@prisma/client', () => {
  const PrismaClient = jest.fn().mockImplementation(() => ({
    securityQuestion: {
      deleteMany:  jest.fn().mockResolvedValue({ count: 4 }),
      createMany:  jest.fn().mockResolvedValue({ count: 4 }),
      findMany:    jest.fn().mockResolvedValue([
        { id: 'q1', question: '¿Nombre de tu primera mascota?', answerHash: '$hashed$' },
        { id: 'q2', question: '¿Ciudad donde naciste?', answerHash: '$hashed$' },
      ]),
      findFirst: jest.fn().mockResolvedValue({
        id: 'q1', userId: 'user-1', question: '¿Nombre?', answerHash: '$hashed$',
      }),
    },
    user: {
      findFirst:  jest.fn().mockResolvedValue({ id: 'user-1', username: 'test' }),
      update:     jest.fn().mockResolvedValue({ id: 'user-1' }),
    },
  }));
  return { PrismaClient };
});

const auth = require('../src/controllers/authController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}

const VALID_4 = [
  { question: '¿Q1?', answer: 'respuesta1' },
  { question: '¿Q2?', answer: 'respuesta2' },
  { question: '¿Q3?', answer: 'respuesta3' },
  { question: '¿Q4?', answer: 'respuesta4' },
];

describe('setSecurityQuestions', () => {
  const req = { user: { id: 'user-1' } };

  test('acepta exactamente 4 preguntas distintas', async () => {
    const res = mockRes();
    await auth.setSecurityQuestions({ ...req, body: { questions: VALID_4 } }, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });

  test('rechaza si no hay 4 preguntas (menos)', async () => {
    const res = mockRes();
    await auth.setSecurityQuestions({ ...req, body: { questions: VALID_4.slice(0, 3) } }, res);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });

  test('rechaza si no hay 4 preguntas (más)', async () => {
    const res = mockRes();
    const five = [...VALID_4, { question: '¿Q5?', answer: 'resp5' }];
    await auth.setSecurityQuestions({ ...req, body: { questions: five } }, res);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });

  test('rechaza preguntas duplicadas', async () => {
    const res = mockRes();
    const dupes = [
      { question: '¿Q1?', answer: 'r1' },
      { question: '¿Q1?', answer: 'r2' }, // duplicate
      { question: '¿Q3?', answer: 'r3' },
      { question: '¿Q4?', answer: 'r4' },
    ];
    await auth.setSecurityQuestions({ ...req, body: { questions: dupes } }, res);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });

  test('rechaza respuesta demasiado corta (< 2 chars)', async () => {
    const res = mockRes();
    const short = [
      { question: '¿Q1?', answer: 'x' }, // too short
      { question: '¿Q2?', answer: 'ok' },
      { question: '¿Q3?', answer: 'ok' },
      { question: '¿Q4?', answer: 'ok' },
    ];
    await auth.setSecurityQuestions({ ...req, body: { questions: short } }, res);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });

  test('rechaza body que no es array', async () => {
    const res = mockRes();
    await auth.setSecurityQuestions({ ...req, body: { questions: 'no-array' } }, res);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });
});

describe('recoverVerify', () => {
  test('rechaza contraseña menor de 6 caracteres', async () => {
    const req = {
      body: { userId: 'u1', questionId: 'q1', answer: 'test', newPassword: '123' },
    };
    const res = mockRes();
    await auth.recoverVerify(req, res);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });

  test('acepta cambio de contraseña válido', async () => {
    const req = {
      body: { userId: 'user-1', questionId: 'q1', answer: 'correcto', newPassword: 'nueva123' },
    };
    const res = mockRes();
    await auth.recoverVerify(req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });

  test('rechaza cuando faltan campos', async () => {
    const req = { body: { userId: 'u1' } };
    const res = mockRes();
    await auth.recoverVerify(req, res);
    expect(res.json.mock.calls[0][0].success).toBe(false);
  });
});
