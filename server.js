const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// Inicializar cliente de Mercado Pago
const mercadopago = require('mercadopago');
mercadopago.configure({
  access_token: process.env.MERCADO_PAGO_ACCESS_TOKEN
});

// Importar cliente Supabase
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ============================================
// ENDPOINT: Crear Preferencia de Pago
// ============================================
app.post('/create-preference', async (req, res) => {
  try {
    const { planId, precio, escortId } = req.body;

    console.log(`[CREATE-PREFERENCE] Recibido: planId=${planId}, precio=${precio}, escortId=${escortId}`);

    // CASO 1: Plan Prueba Gratis ($0)
    if (precio === 0) {
      console.log(`[FREE-PLAN] Activando Plan Prueba para escort ${escortId}`);
      
      const vencimiento = new Date();
      vencimiento.setDate(vencimiento.getDate() + 7);

      const { error } = await supabase
        .from('escorts')
        .update({
          plan: 'Prueba Premium',
          vence_suscripcion: vencimiento.toISOString().split('T')[0],
          verificada: true
        })
        .eq('id', escortId);

      if (error) {
        console.error(`[ERROR] Supabase update failed:`, error);
        return res.status(500).json({ error: 'Error al activar plan' });
      }

      console.log(`[SUCCESS] Plan Prueba activado hasta ${vencimiento.toISOString().split('T')[0]}`);
      return res.json({ success: true, message: 'Plan Prueba activado por 7 días' });
    }

    // CASO 2: Planes Pagos (Mercado Pago)
    console.log(`[PAID-PLAN] Creando preferencia en Mercado Pago para plan ${planId}`);

    const planNames = {
      'mensual': 'Plan Mensual GemidosVIP',
      'trimestral': 'Plan Trimestral GemidosVIP',
      'semestral': 'Plan Semestral GemidosVIP',
      'anual': 'Plan Anual GemidosVIP'
    };

    const preference = {
      items: [
        {
          title: planNames[planId] || 'Suscripción GemidosVIP',
          unit_price: precio,
          quantity: 1,
          currency_id: 'ARS'
        }
      ],
      payer: {
        email: 'cliente@gemidosvip.com' // Se puede obtener del frontend si es necesario
      },
      external_reference: escortId, // CRÍTICO: Vincula el pago con la escort
      notification_url: `${process.env.BACKEND_URL}/webhook`,
      back_urls: {
        success: `${process.env.FRONTEND_URL}/dashboard?payment=success`,
        failure: `${process.env.FRONTEND_URL}/dashboard?payment=failure`,
        pending: `${process.env.FRONTEND_URL}/dashboard?payment=pending`
      },
      auto_return: 'approved'
    };

    const response = await mercadopago.preferences.create(preference);
    console.log(`[SUCCESS] Preferencia creada: ${response.body.id}`);

    res.json({
      success: true,
      init_point: response.body.init_point // URL de pago
    });

  } catch (error) {
    console.error('[ERROR] create-preference:', error.message);
    res.status(500).json({ error: 'Error al crear preferencia de pago' });
  }
});

// ============================================
// WEBHOOK: Notificaciones de Mercado Pago
// ============================================
app.post('/webhook', async (req, res) => {
  try {
    const { type, data } = req.body;

    console.log(`[WEBHOOK] Notificación recibida: type=${type}`);

    // Solo procesar notificaciones de pago
    if (type !== 'payment') {
      console.log(`[WEBHOOK] Tipo ignorado: ${type}`);
      return res.sendStatus(200);
    }

    const paymentId = data.id;
    console.log(`[WEBHOOK] Procesando pago ID: ${paymentId}`);

    // Obtener detalles del pago desde Mercado Pago
    const paymentResponse = await mercadopago.payment.findById(paymentId);
    const payment = paymentResponse.body;

    console.log(`[WEBHOOK] Estado del pago: ${payment.status}`);

    // Verificar si el pago fue aprobado
    if (payment.status !== 'approved') {
      console.log(`[WEBHOOK] Pago no aprobado. Estado: ${payment.status}`);
      return res.sendStatus(200);
    }

    // Extraer escortId del external_reference
    const escortId = payment.external_reference;
    console.log(`[WEBHOOK] Escort ID: ${escortId}`);

    // Determinar el plan basado en el monto
    const monto = payment.transaction_amount;
    let planName, diasVencimiento;

    if (monto === 80000) {
      planName = 'Mensual';
      diasVencimiento = 30;
    } else if (monto === 200000) {
      planName = 'Trimestral';
      diasVencimiento = 90;
    } else if (monto === 350000) {
      planName = 'Semestral';
      diasVencimiento = 180;
    } else if (monto === 600000) {
      planName = 'Anual';
      diasVencimiento = 365;
    } else {
      console.error(`[ERROR] Monto no reconocido: ${monto}`);
      return res.sendStatus(400);
    }

    // Calcular fecha de vencimiento
    const vencimiento = new Date();
    vencimiento.setDate(vencimiento.getDate() + diasVencimiento);

    console.log(`[WEBHOOK] Actualizando escort ${escortId} con plan ${planName}, vence: ${vencimiento.toISOString().split('T')[0]}`);

    // Actualizar Supabase
    const { error } = await supabase
      .from('escorts')
      .update({
        plan: planName,
        vence_suscripcion: vencimiento.toISOString().split('T')[0],
        verificada: true
      })
      .eq('id', escortId);

    if (error) {
      console.error(`[ERROR] Supabase update failed:`, error);
      return res.sendStatus(500);
    }

    console.log(`[SUCCESS] Escort ${escortId} actualizada con plan ${planName}`);
    res.sendStatus(200);

  } catch (error) {
    console.error('[ERROR] webhook:', error.message);
    res.sendStatus(500);
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 GemidosVIP Backend corriendo en puerto ${PORT}`);
  console.log(`📍 Webhook URL: ${process.env.BACKEND_URL}/webhook`);
});
