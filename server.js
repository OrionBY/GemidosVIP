import express from 'express';
import cors from 'cors';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago'; 
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// 1. Configuración de Mercado Pago
const client = new MercadoPagoConfig({ 
    accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN 
});

// 2. Configuración de Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 3. Middlewares - CONFIGURACIÓN CORS (EL FIX IMPORTANTE)
const allowedOrigins = [
  'https://gemidosvip.com',
  'https://www.gemidosvip.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1) {
            // Permitimos todo por ahora para evitar bloqueos, pero logueamos el intento
            console.log("⚠️ Origen no listado intentando conectar:", origin);
            return callback(null, true); 
        }
        return callback(null, true);
    },
    methods: ["GET", "POST", "OPTIONS", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    credentials: true
}));

app.use(express.json());

// --- RUTAS ---

app.get('/', (req, res) => {
    res.send('Servidor GemidosVIP v6.0 - FULL + CORS FIX 🚀');
});

// =================================================================
// A. NUEVA RUTA UNIVERSAL (Para la Billetera de Clientes)
// =================================================================
app.post('/create-preference', async (req, res) => {
    try {
      const { title, price, quantity, external_reference, back_urls } = req.body;
      console.log("💰 Billetera:", { title, price });
  
      const body = {
        items: [
          {
            title: title || "Carga de Saldo",
            unit_price: Number(price),
            quantity: Number(quantity || 1),
            currency_id: "ARS",
          }
        ],
        external_reference: external_reference, 
        back_urls: back_urls,
        auto_return: "approved",
      };
  
      const preference = new Preference(client);
      const result = await preference.create({ body });
  
      res.json({
        id: result.id,
        init_point: result.init_point 
      });
  
    } catch (error) {
      console.error("❌ Error Billetera:", error);
      res.status(500).json({ error: "No se pudo crear el link de pago" });
    }
});

// =================================================================
// B. RUTA DE ESCORTS (Suscripciones)
// =================================================================
app.post('/create_preference', async (req, res) => {
    try {
        console.log("👑 Escort Sub:", req.body);
        
        // URL FIJA DE PRODUCCIÓN PARA EVITAR ERRORES DE REDIRECCIÓN
        const frontendUrl = 'https://gemidosvip.com';

        const body = {
            items: [
                {
                    id: 'vip_subscription',
                    title: req.body.title || 'Suscripción Black Rose',
                    quantity: 1,
                    unit_price: Number(req.body.price),
                    currency_id: 'ARS',
                },
            ],
            metadata: {
                user_email: req.body.user_email 
            },
            back_urls: {
                success: `${frontendUrl}/dashboard?tab=suscripcion&status=approved`,
                failure: `${frontendUrl}/dashboard?tab=suscripcion&status=failure`,
                pending: `${frontendUrl}/dashboard?tab=suscripcion&status=pending`
            },
            auto_return: "approved",
            notification_url: "https://api.gemidosvip.com/webhook" 
        };

        const preference = new Preference(client);
        const result = await preference.create({ body });

        res.json({ id: result.id, init_point: result.init_point });
    } catch (error) {
        console.error("❌ Error Escort Sub:", error);
        res.status(500).json({ error: "Error al crear la preferencia de pago" });
    }
});

// =================================================================
// C. VERIFICAR PAGO (Restaurada)
// =================================================================
app.post('/verify-payment', async (req, res) => {
    try {
        const { payment_id } = req.body;
        
        if (!payment_id) {
            return res.status(400).json({ message: "Falta payment_id" });
        }

        const payment = new Payment(client);
        const paymentData = await payment.get({ id: payment_id });

        const isApproved = paymentData.status === 'approved';

        res.json({ 
            verified: isApproved,
            status: paymentData.status, 
            status_detail: paymentData.status_detail,
            transactionId: paymentData.id
        });

    } catch (error) {
        console.error("Error verificando pago:", error);
        res.status(500).json({ message: "Error verificando el pago en Mercado Pago" });
    }
});

// =================================================================
// D. GUARDAR SUSCRIPCIÓN (Restaurada)
// =================================================================
app.post('/save-subscription', async (req, res) => {
    const { userId, planId, payment_id } = req.body;
    console.log("💾 Guardando suscripción:", { userId, payment_id });

    try {
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 30); 

        // Actualizamos perfil
        const { error: profileError } = await supabase
            .from('profiles') 
            .update({ 
                subscription_status: 'active',
                plan_id: planId || 'black_rose',
                subscription_end_date: endDate.toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', userId);

        if (profileError) throw profileError;

        // Guardamos log de pago (opcional, si falla no rompemos todo)
        try {
            await supabase.from('payment_logs').insert({
                user_id: userId,
                payment_id: payment_id,
                status: 'completed',
                provider: 'mercadopago'
            });
        } catch (logError) {
            console.error("⚠️ Error guardando log (no crítico):", logError);
        }

        res.json({ success: true, message: "Suscripción activada correctamente" });

    } catch (error) {
        console.error("❌ Error guardando suscripción:", error);
        res.status(500).json({ 
            success: false, 
            error: "Error actualizando la base de datos",
            details: error.message 
        });
    }
});

// =================================================================
// E. WEBHOOK
// =================================================================
app.post('/webhook', async (req, res) => {
    const payment = req.query;
    if (payment.type === "payment") {
        console.log("🔔 Webhook Pago ID:", payment['data.id']);
    }
    res.sendStatus(200);
});

app.listen(port, () => {
    console.log(`✅ Servidor corriendo en el puerto ${port}`);
});