// Cargar las variables de entorno desde un archivo .env
require('dotenv').config();

const express = require('express');
const puppeteer = require('puppeteer');
const xmlbuilder = require('xmlbuilder');

const app = express();
app.use(express.json()); // Para manejar el cuerpo de solicitudes POST

// Variables para almacenar el XML generado para cada bus
let latestXml = {
    bus_1: null,
    bus_2: null,
    bus_3: null
};

// Matrículas de los buses
const buses = {
    bus_1: 'GQP413',
    bus_2: 'DPH418',
    bus_3: 'FMD808'
};

// Función para extraer datos y generar el XML para un bus en específico
async function extractDataForBus(busKey, busMatricula) {
    let browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    let page = await browser.newPage();

    try {
        console.log(`Iniciando búsqueda para el bus ${busKey} (${busMatricula})...`);
        await page.goto('https://avl.easytrack.com.ar/login', { waitUntil: 'domcontentloaded' });

        console.log('Esperando que el formulario de login esté disponible...');
        await page.waitForSelector('app-root app-login.ng-star-inserted');

        console.log('Ingresando credenciales...');
        await page.type('app-root app-login.ng-star-inserted #mat-input-0', 'naranja2024@transportesversari');
        await page.type('app-root app-login.ng-star-inserted #mat-input-1', 'naranja');

        console.log('Presionando Enter...');
        await page.keyboard.press('Enter');

        try {
            console.log('Esperando la navegación después de presionar Enter...');
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 });
        } catch (error) {
            console.error(`Fallo al intentar iniciar sesión para ${busKey}. Intentando con el botón de inicio de sesión...`);
            await page.click('app-root app-login.ng-star-inserted #btn-login');
            await page.waitForNavigation({ waitUntil: 'domcontentloaded' });
        }

        // Función interna para buscar la dirección del bus
        async function getDataFromDashboard(url) {
            console.log(`Navegando a la URL: ${url} para el bus ${busKey}`);
            await page.goto(url, { waitUntil: 'domcontentloaded' });

            const containerSelector = `div.ag-cell-value[aria-colindex="2"][role="gridcell"]:contains(${busMatricula})`;
            console.log(`Esperando el elemento que contiene la matrícula del bus ${busKey}...`);

            try {
                await page.waitForSelector(containerSelector, { timeout: 15000 });
                const extractedText = await page.$eval(`div.ag-cell-value[aria-colindex="7"][role="gridcell"] a`, element => element.textContent.trim());

                console.log(`Texto extraído para ${busKey}: ${extractedText}`);
                const truncatedText = extractedText.split(',').slice(0, 2).join(',');

                return { success: true, text: truncatedText };
            } catch (error) {
                console.error(`No se encontró el bus ${busKey} en circulación.`);
                return { success: false, text: '' };
            }
        }

        // Intentar buscar la dirección en varias URL si es necesario
        let result = await getDataFromDashboard('https://avl.easytrack.com.ar/dashboard/1000');
        if (!result.success) {
            result = await getDataFromDashboard('https://avl.easytrack.com.ar/dashboard/1007');
            if (!result.success) {
                console.log(`No se encontró la ubicación del bus ${busKey} en ninguna URL.`);
                return;
            }
        }

        // Si se encuentra la dirección, generar el XML correspondiente
        if (result.success) {
            console.log(`Generando XML para el bus ${busKey}...`);
            const xml = xmlbuilder.create('Response')
                .ele('Say', { voice: 'Polly.Andres-Neural', language: "es-MX" }, result.text)
                .end({ pretty: true });

            console.log(`XML generado para ${busKey}:\n${xml}`);

            // Guardar el XML en la variable global
            latestXml[busKey] = xml;
        }
    } catch (error) {
        console.error(`Error al extraer la ubicación para ${busKey}:`, error);
    } finally {
        console.log(`Cerrando el navegador para ${busKey}...`);
        await browser.close();
    }
}

// Manejo de la solicitud POST para actualizar el XML de todos los buses
app.post('/update', async (req, res) => {
    console.log('Solicitud POST entrante para actualizar los XML de todos los buses');

    try {
        // Ejecutar las extracciones en paralelo
        await Promise.all([
            extractDataForBus('bus_1', buses.bus_1),
            extractDataForBus('bus_2', buses.bus_2),
            extractDataForBus('bus_3', buses.bus_3)
        ]);

        res.status(200).send({ message: 'XML de los buses se están actualizando.' });
    } catch (error) {
        console.error('Error al actualizar los XML de los buses:', error);
        res.status(500).send({ message: 'Error al actualizar los XML.' });
    }
});

// Manejo de las solicitudes GET para cada bus
app.get('/voice/:busKey', (req, res) => {
    const busKey = req.params.busKey;
    console.log(`Solicitud entrante a /voice/${busKey}`);

    if (latestXml[busKey]) {
        res.type('application/xml');
        res.send(latestXml[busKey]);
    } else {
        // Generar un XML de error en caso de no tener datos recientes
        const xml = xmlbuilder.create('Response')
            .ele('Say', { voice: 'Polly.Andres-Neural', language: "es-MX" }, 'Lo sentimos, no se pudo obtener la información en este momento. Por favor, intente nuevamente más tarde.')
            .end({ pretty: true });

        res.type('application/xml');
        res.send(xml);
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Servidor escuchando en el puerto ${PORT}`);
});