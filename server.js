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

// 3. Middlewares
app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    methods: ["POST", "GET"],
    credentials: true
}));
app.use(express.json());

// --- RUTAS ---

// A. Crear Preferencia de Pago
app.post('/create_preference', async (req, res) => {
    try {
        const body = {
            items: [
                {
                    id: 'vip_subscription',
                    title: req.body.title || 'Suscripción VIP',
                    quantity: 1,
                    unit_price: Number(req.body.price),
                    currency_id: 'ARS',
                },
            ],
            metadata: {
                user_id: req.body.userId 
            },
            back_urls: {
                success: `${process.env.FRONTEND_URL}/dashboard?tab=suscripcion`,
                failure: `${process.env.FRONTEND_URL}/dashboard?tab=suscripcion`,
                pending: `${process.env.FRONTEND_URL}/dashboard?tab=suscripcion`
            },
            auto_return: "approved",
            notification_url: "https://gemidosvip-production.up.railway.app/webhook" 
        };

        const preference = new Preference(client);
        const result = await preference.create({ body });

        res.json({ id: result.id });
    } catch (error) {
        console.error("Error al crear preferencia:", error);
        res.status(500).json({ error: "Error al crear la preferencia de pago" });
    }
});

// B. Verificar Pago
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

// C. GUARDAR SUSCRIPCIÓN (CORREGIDO con UPSERT)
app.post('/save-subscription', async (req, res) => {
    const { userId, planId, payment_id } = req.body;

    try {
        // 1. Calcular fecha de vencimiento (30 días por defecto)
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 30); 

        // 2. Actualizar O CREAR el perfil del usuario en Supabase
        // Usamos .upsert() en lugar de .update() para crear la fila si no existe
        const { data, error } = await supabase
            .from('profiles') 
            .upsert({ 
                id: userId, // Obligatorio para crear la fila si no existe
                subscription_status: 'active',
                plan_id: planId || 'vip_monthly',
                subscription_end_date: endDate.toISOString(),
                updated_at: new Date().toISOString()
            })
            .select(); // Importante para devolver el dato guardado y confirmar éxito

        if (error) throw error;

        // 3. (Opcional) Guardar log en 'payment_logs'
        // Si esta tabla no existe o da error, no detiene el flujo principal gracias al try/catch global
        try {
            await supabase.from('payment_logs').insert({
                user_id: userId,
                payment_id: payment_id,
                status: 'completed',
                provider: 'mercadopago'
            });
        } catch (logError) {
            console.error("Error guardando log (no crítico):", logError);
        }

        res.json({ success: true, message: "Suscripción activada correctamente" });

    } catch (error) {
        console.error("Error guardando suscripción:", error);
        res.status(500).json({ 
            success: false, 
            error: "Error actualizando la base de datos",
            details: error.message 
        });
    }
});

app.post('/webhook', async (req, res) => {
    res.sendStatus(200);
});

app.get('/', (req, res) => {
    res.send('Servidor GemidosVIP v3.0 - Upsert Fix');
});

app.listen(port, () => {
    console.log(`Servidor corriendo en el puerto ${port}`);
});