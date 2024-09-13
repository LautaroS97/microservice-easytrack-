// Cargar las variables de entorno desde un archivo .env
require('dotenv').config();

const express = require('express');
const puppeteer = require('puppeteer');
const xmlbuilder = require('xmlbuilder');

const app = express();
app.use(express.json()); // Para manejar el cuerpo de solicitudes POST

// Variable para almacenar el XML generado
let latestXml = {
    bus_1: null,
    bus_2: null,
    bus_3: null,
};

// Matrículas de los buses
const buses = {
    bus_1: 'GQP413',
    bus_2: 'DPH418',
    bus_3: 'FMD808',
};

// Función para esperar que el contenedor de los datos y las filas estén presentes
async function waitForDataContainer(page) {
    try {
        await page.waitForSelector('.ag-center-cols-container', {
            timeout: 20000,
        });

        await page.waitForFunction(() => {
            return document.querySelectorAll('.ag-center-cols-container .ag-row').length > 0;
        }, { timeout: 20000 });

        console.log('Contenedor de datos y filas encontrados.');
        return true;
    } catch (error) {
        console.error('Error: El contenedor de datos o las filas no se cargaron a tiempo.', error);
        return false;
    }
}

// Función para buscar la matrícula y extraer la dirección
async function findBusData(page, busMatricula) {
    try {
        const busData = await page.evaluate((busMatricula) => {
            const rows = document.querySelectorAll('.ag-center-cols-container .ag-row');
            for (let row of rows) {
                const matriculaCell = row.querySelector('div[col-id="domain_veh"]');
                if (matriculaCell && matriculaCell.textContent.trim() === busMatricula) {
                    const positionCell = row.querySelector('div[col-id="position"]');
                    if (positionCell) {
                        const addressLink = positionCell.querySelector('a');
                        if (addressLink) {
                            const addressText = addressLink.textContent.trim();
                            return addressText;
                        }
                    }
                }
            }
            return null;
        }, busMatricula);

        if (busData) {
            console.log(`Matrícula ${busMatricula} encontrada con dirección: ${busData}`);
            return { success: true, text: busData };
        } else {
            console.log(`No se encontró la matrícula ${busMatricula}.`);
            return { success: false, text: '' };
        }
    } catch (error) {
        console.error(`Error buscando la dirección para ${busMatricula}:`, error);
        return { success: false, text: '' };
    }
}

// Función para extraer datos de los buses y generar el XML
async function extractDataAndGenerateXML() {
    const browser = await puppeteer.launch({
        headless: true, // Cambiar a 'false' para depurar y ver el navegador
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();

    try {
        console.log('Navegando a la URL de login...');
        await page.goto('https://avl.easytrack.com.ar/login', { waitUntil: 'domcontentloaded' });

        console.log('Esperando que el formulario de login esté disponible...');
        await page.waitForSelector('app-root app-login.ng-star-inserted');

        console.log('Ingresando credenciales...');
        await page.type('app-root app-login.ng-star-inserted #mat-input-0', 'usuarioexterno@transportesversari');
        await page.type('app-root app-login.ng-star-inserted #mat-input-1', 'usu4rio3xt3rn0');

        console.log('Presionando Enter...');
        await page.keyboard.press('Enter');

        console.log('Esperando la navegación después de presionar Enter...');
        await page.waitForNavigation({ waitUntil: 'domcontentloaded' });

        console.log('Navegando a la URL del dashboard...');
        await page.goto('https://avl.easytrack.com.ar/dashboard/1000', { waitUntil: 'domcontentloaded' });

        // Asegurar que los datos están cargados
        const containerReady = await waitForDataContainer(page);
        if (!containerReady) {
            throw new Error('No se pudo cargar el contenedor de datos.');
        }

        let busesNoEncontrados = [];

        for (const [key, matricula] of Object.entries(buses)) {
            console.log(`Buscando la matrícula ${matricula}...`);
            const result = await findBusData(page, matricula);
            if (result.success) {
                // Generar el XML correspondiente
                const xml = xmlbuilder.create('Response')
                    .ele('Say', { voice: 'Polly.Andres-Neural', language: "es-MX" }, result.text)
                    .end({ pretty: true });

                console.log(`XML generado para ${key}:\n${xml}`);
                latestXml[key] = xml;
            } else {
                busesNoEncontrados.push({ key, matricula });
            }
        }

        // Si no se encontraron algunas matrículas, navegar a la segunda URL
        if (busesNoEncontrados.length > 0) {
            console.log('Algunas matrículas no fueron encontradas. Navegando a la segunda URL...');
            await page.goto('https://avl.easytrack.com.ar/dashboard/1007', { waitUntil: 'domcontentloaded' });

            // Asegurar que los datos están cargados
            const containerReadySecond = await waitForDataContainer(page);
            if (!containerReadySecond) {
                throw new Error('No se pudo cargar el contenedor de datos en la segunda URL.');
            }

            for (const { key, matricula } of busesNoEncontrados) {
                console.log(`Buscando la matrícula ${matricula} en la segunda URL...`);
                const result = await findBusData(page, matricula);
                if (result.success) {
                    // Generar el XML correspondiente
                    const xml = xmlbuilder.create('Response')
                        .ele('Say', { voice: 'Polly.Andres-Neural', language: "es-MX" }, result.text)
                        .end({ pretty: true });

                    console.log(`XML generado para ${key}:\n${xml}`);
                    latestXml[key] = xml;
                } else {
                    console.log(`No se encontró la matrícula ${matricula} en ninguna URL.`);
                }
            }
        }

    } catch (error) {
        console.error('Error al extraer los datos:', error);
    } finally {
        console.log('Cerrando el navegador...');
        await browser.close();
    }
}

// Manejo de la solicitud POST para actualizar el XML de todos los buses
app.post('/update', async (req, res) => {
    console.log('Solicitud POST entrante para actualizar los XML de todos los buses');
    try {
        await extractDataAndGenerateXML();
        res.status(200).send({ message: 'Solicitud recibida, XML de los buses se está actualizando.' });
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