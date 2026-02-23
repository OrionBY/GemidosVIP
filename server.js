import express from 'express';
import cors from 'cors';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// 1. Configuración de Mercado Pago
// Usa tus credenciales de ACCESS TOKEN (Production o Test según corresponda)
const client = new MercadoPagoConfig({ 
    accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN 
});

// 2. Middlewares
app.use(cors({
    origin: process.env.FRONTEND_URL || '*', // Permite peticiones desde tu web
    methods: ["POST", "GET"],
    credentials: true
}));
app.use(express.json());

// 3. Ruta: Crear Preferencia (Para generar el link de pago)
app.post('/create_preference', async (req, res) => {
    try {
        const body = {
            items: [
                {
                    title: 'Suscripción VIP',
                    quantity: 1,
                    unit_price: Number(req.body.price) || 1000,
                    currency_id: 'ARS',
                },
            ],
            back_urls: {
                success: "https://gemidosvip.com/dashboard",
                failure: "https://gemidosvip.com/dashboard",
                pending: "https://gemidosvip.com/dashboard"
            },
            auto_return: "approved",
            // Esta es la URL a la que Mercado Pago avisará (Webhook)
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

// 4. Ruta: Webhook (Donde Mercado Pago notifica)
app.post('/webhook', async (req, res) => {
    const paymentId = req.query.id || req.query['data.id'];
    
    try {
        if(paymentId){
             // Aquí podrías consultar el estado del pago y actualizar tu base de datos
            console.log("Pago recibido ID:", paymentId);
        }
        res.sendStatus(200);
    } catch (error) {
        console.log("Error webhook:", error);
        res.sendStatus(500);
    }
});

// 5. Ruta: Verificar Pago (La que tu Frontend estaba buscando y daba 404)
// Esta ruta sirve si tu frontend quiere preguntar manualmente por el estado
app.post('/verify-payment', async (req, res) => {
    try {
        const { payment_id } = req.body; // El frontend debe enviar el ID
        
        if (!payment_id) {
            return res.status(400).json({ message: "Falta payment_id" });
        }

        const payment = new Payment(client);
        const paymentData = await payment.get({ id: payment_id });

        res.json({ 
            status: paymentData.status, 
            status_detail: paymentData.status_detail 
        });

    } catch (error) {
        console.error("Error verificando pago:", error);
        res.status(500).json({ message: "Error verificando el pago" });
    }
});

// Ruta base para probar que el server vive
app.get('/', (req, res) => {
    res.send('Servidor GemidosVIP funcionando 🚀');
});

app.listen(port, () => {
    console.log(`Servidor corriendo en el puerto ${port}`);
});