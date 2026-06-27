const { ok, fail } = require('../src/utils/response');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}

describe('Utilidad de respuesta', () => {
  test('ok() devuelve 200 y success:true', () => {
    const res = mockRes();
    ok(res, { foo: 'bar' });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { foo: 'bar' },
      error: null,
    });
  });

  test('ok() acepta código de estado personalizado', () => {
    const res = mockRes();
    ok(res, {}, 201);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('fail() devuelve 400 y success:false', () => {
    const res = mockRes();
    fail(res, 'Algo falló');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      data: null,
      error: 'Algo falló',
    });
  });

  test('fail() acepta código de estado personalizado', () => {
    const res = mockRes();
    fail(res, 'No autorizado', 401);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
