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

// Función para buscar la dirección del bus en la URL y devolver la posición
async function getDataFromDashboard(page, busKey, busMatricula, url) {
    console.log(`Navegando a la URL: ${url} para el bus ${busKey}`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    const containerSelector = `div.ag-center-cols-container div.ag-row div.ag-cell[aria-colindex="2"]:contains(${busMatricula})`;
    console.log(`Esperando el elemento que contiene la matrícula del bus ${busKey}...`);

    try {
        await page.waitForSelector(containerSelector, { timeout: 15000 });
        const extractedText = await page.$eval(
            `div.ag-center-cols-container div.ag-row div.ag-cell[aria-colindex="7"] a`,
            element => element.textContent.trim()
        );

        console.log(`Texto extraído para ${busKey}: ${extractedText}`);
        const truncatedText = extractedText.split(',').slice(0, 2).join(',');

        return { success: true, text: truncatedText };
    } catch (error) {
        console.error(`No se encontró el bus ${busKey} en la URL: ${url}`);
        return { success: false, text: '' };
    }
}

// Función para extraer datos y generar el XML para un bus en específico
async function extractDataForBus(page, busKey, busMatricula) {
    console.log(`Iniciando búsqueda para el bus ${busKey} (${busMatricula})...`);

    // Intentar buscar la dirección en varias URL si es necesario
    let result = await getDataFromDashboard(page, busKey, busMatricula, 'https://avl.easytrack.com.ar/dashboard/1000');
    if (!result.success) {
        result = await getDataFromDashboard(page, busKey, busMatricula, 'https://avl.easytrack.com.ar/dashboard/1007');
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
}

// Manejo de la solicitud POST para actualizar el XML de todos los buses
app.post('/update', async (req, res) => {
    console.log('Solicitud POST entrante para actualizar los XML de todos los buses');

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    try {
        // Ejecutar las extracciones en paralelo para cada bus
        await Promise.all([
            extractDataForBus(page, 'bus_1', buses.bus_1),
            extractDataForBus(page, 'bus_2', buses.bus_2),
            extractDataForBus(page, 'bus_3', buses.bus_3)
        ]);

        res.status(200).send({ message: 'XML de los buses se están actualizando.' });
    } catch (error) {
        console.error('Error al actualizar los XML de los buses:', error);
        res.status(500).send({ message: 'Error al actualizar los XML.' });
    } finally {
        console.log('Cerrando el navegador...');
        await browser.close();
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