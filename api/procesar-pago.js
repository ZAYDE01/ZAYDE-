// api/procesar-pago.js
//
// Backend de Vercel (Node.js Serverless Function) que recibe los datos
// del "Payment Brick" de Mercado Pago desde el sitio (el token de la
// tarjeta, ya generado de forma segura por el navegador del cliente,
// nunca el número de tarjeta en sí) y cobra usando el Access Token
// SECRETO de Mercado Pago, que solo vive aquí — nunca en el HTML.
//
// CONFIGURACIÓN NECESARIA EN VERCEL (una sola vez):
//   1. Ve a tu proyecto en vercel.com → Settings → Environment Variables.
//   2. Agrega una variable llamada  MP_ACCESS_TOKEN  con el valor de tu
//      Access Token de Mercado Pago (el de producción cuando ya quieras
//      cobrar de verdad; el de prueba mientras estás probando).
//   3. Vuelve a desplegar el proyecto (Vercel lo hace solo si conectaste
//      GitHub y le haces push a este archivo).
//
// Este archivo va en la carpeta  /api/  de tu repositorio, tal cual,
// sin necesidad de instalar ningún paquete extra (usa "fetch", que ya
// viene incluido en Vercel).

module.exports = async function handler(req, res) {
  // Solo aceptamos POST (que es lo que manda el sitio al pagar).
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    console.error('Falta configurar MP_ACCESS_TOKEN en Vercel.');
    return res.status(500).json({ error: 'El servidor de pagos no está configurado todavía.' });
  }

  try {
    const {
      token,
      issuer_id,
      payment_method_id,
      installments,
      payer,
      transaction_amount,
      description,
    } = req.body || {};

    // Validación mínima: si falta algo esencial, ni siquiera intentamos
    // cobrar (evita mandar una solicitud inválida a Mercado Pago).
    if (!token || !payment_method_id || !transaction_amount) {
      return res.status(400).json({ error: 'Faltan datos del pago.' });
    }

    // Llave de idempotencia: evita que un doble clic (o un reintento de
    // red) cobre dos veces el mismo pago.
    const idempotencyKey =
      (globalThis.crypto && globalThis.crypto.randomUUID)
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const respuestaMP = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'X-Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        transaction_amount: Number(transaction_amount),
        token,
        description: description || 'Reservación en La Fortuna',
        installments: installments || 1,
        payment_method_id,
        issuer_id,
        payer: {
          email: payer && payer.email,
          identification: payer && payer.identification,
        },
      }),
    });

    const datos = await respuestaMP.json();

    if (!respuestaMP.ok) {
      console.error('Mercado Pago rechazó la solicitud:', datos);
      return res.status(200).json({
        status: 'rejected',
        status_detail: (datos && datos.message) || 'error_desconocido',
      });
    }

    // Respondemos solo lo que el sitio necesita saber — no reenviamos
    // toda la respuesta de Mercado Pago (puede traer datos sensibles del
    // pagador que no hace falta exponer al navegador).
    return res.status(200).json({
      status: datos.status,               // 'approved' | 'in_process' | 'rejected' | ...
      status_detail: datos.status_detail,  // motivo específico si fue rechazado
      id: datos.id,
    });
  } catch (err) {
    console.error('Error procesando el pago:', err);
    return res.status(500).json({ error: 'No se pudo procesar el pago.' });
  }
};
