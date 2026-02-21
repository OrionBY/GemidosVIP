const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());
app.use(cors());

// 1. CONFIGURACIÓN DE CLIENTES
// Mercado Pago SDK v2
const client = new MercadoPagoConfig({ 
  accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN 
});

// Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 2. ENDPOINT: CREAR PREFERENCIA (PAGOS Y TRIAL)
app.post('/create-preference', async (req, res) => {
  try {
    const { planId, precio, escortId } = req.body;
    console.log(`[SOLICITUD] Escort: ${escortId} | Plan: ${planId} | Monto: $${precio}`);

    // CASO A: PLAN PRUEBA GRATIS (7 DÍAS)
    if (precio === 0 || planId === 'trial') {
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

      if (error) throw error;
      return res.json({ success: true, message: 'Trial activado' });
    }

    // CASO B: PLANES PAGOS CON MERCADO PAGO
    const preference = new Preference(client);
    const response = await preference.create({
      body: {
        items: [{
          title: `Plan ${planId} - GemidosVIP`,
          unit_price: Number(precio),
          quantity: 1,
          currency_id: 'ARS'
        }],
        external_reference: escortId.toString(),
        notification_url: `${process.env.BACKEND_URL}/webhook`,
        back_urls: {
          success: `${process.env.FRONTEND_URL}/dashboard?payment=success`,
          failure: `${process.env.FRONTEND_URL}/dashboard?payment=failure`
        },
        auto_return: 'approved'
      }
    });

    res.json({ success: true, init_point: response.init_point });

  } catch (error) {
    console.error('[ERROR CREATE-PREFERENCE]:', error);
    res.status(500).json({ error: 'Error al procesar la solicitud' });
  }
});

// 3. ENDPOINT: WEBHOOK (NOTIFICACIONES AUTOMÁTICAS)
app.post('/webhook', async (req, res) => {
  try {
    const { type, data } = req.body;

    if (type === 'payment') {
      const paymentId = data.id;
      const paymentClient = new Payment(client);
      const payment = await paymentClient.get({ id: paymentId });

      if (payment.status === 'approved') {
        const escortId = payment.external_reference;
        const monto = payment.transaction_amount;

        // Determinar días según los nuevos precios
        let dias = 30;
        let nombrePlan = 'Mensual';

        if (monto === 200000) { dias = 90; nombrePlan = 'Trimestral'; }
        else if (monto === 350000) { dias = 180; nombrePlan = 'Semestral'; }
        else if (monto === 600000) { dias = 365; nombrePlan = 'Anual'; }

        const vencimiento = new Date();
        vencimiento.setDate(vencimiento.getDate() + dias);

        await supabase
          .from('escorts')
          .update({
            plan: nombrePlan,
            vence_suscripcion: vencimiento.toISOString().split('T')[0],
            verificada: true
          })
          .eq('id', escortId);

        console.log(`[EXITO] Escort ${escortId} actualizada al plan ${nombrePlan}`);
      }
    }
    res.sendStatus(200);
  } catch (error) {
    console.error('[WEBHOOK ERROR]:', error);
    res.sendStatus(500);
  }
});

// 4. HEALTH CHECK & LISTEN
app.get('/health', (req, res) => res.json({ status: 'OK', MP_V: '2.0' }));

const PORT = process.env.PORT || 3001; //
app.listen(PORT, () => console.log(`🚀 Servidor GemidosVIP en puerto ${PORT}`));