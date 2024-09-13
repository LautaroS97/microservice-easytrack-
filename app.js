// Cargar las variables de entorno desde un archivo .env 
require('dotenv').config();

const express = require('express');
const puppeteer = require('puppeteer');
const xmlbuilder = require('xmlbuilder');

const app = express();
app.use(express.json()); // Para manejar el cuerpo de solicitudes POST

let latestXml = {}; // Objeto para almacenar los XML generados para cada bus

// Lista de matrículas de los buses
const buses = {
    bus_1: 'GQP413',
    bus_2: 'DPH418',
    bus_3: 'FMD808',
};

async function extractDataAndGenerateXML() {
    let browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    let page = await browser.newPage();

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

        async function getDataFromDashboard(url, busMatricula) {
            console.log(`Navegando a la URL: ${url}`);
            await page.goto(url, { waitUntil: 'domcontentloaded' });
        
            // Esperar 5 segundos para dar tiempo a que la tabla se cargue completamente
            await delay(5000);
        
            console.log(`Buscando la matrícula ${busMatricula}...`);
            try {
                await page.waitForSelector('.ag-center-cols-container', { timeout: 15000 });
        
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
                console.error(`Error al buscar la matrícula ${busMatricula}:`, error);
                return { success: false, text: '' };
            }
        }              

        for (const [key, matricula] of Object.entries(buses)) {
            let result = await getDataFromDashboard('https://avl.easytrack.com.ar/dashboard/1000', matricula);
            if (!result.success) {
                result = await getDataFromDashboard('https://avl.easytrack.com.ar/dashboard/1007', matricula);
                if (!result.success) {
                    console.log(`No se pudo obtener el dato de ninguna de las URLs para el bus ${key}`);
                }
            }

            if (result.success) {
                console.log('Convirtiendo el texto a XML...');
                const xml = xmlbuilder.create('Response')
                    .ele('Say', { voice: 'Polly.Andres-Neural', language: "es-MX" }, result.text)
                    .end({ pretty: true });

                console.log(`XML generado para ${key}:\n`, xml);

                // Guardar el XML en el objeto global para que esté disponible en /voice/:busKey
                latestXml[key] = xml;
            } else {
                console.error(`No se pudo obtener la dirección para el bus ${key}`);
            }
        }

    } catch (error) {
        console.error('Error al extraer el texto:', error);
    } finally {
        console.log('Cerrando el navegador...');
        await browser.close();
    }
}

// Manejo de la solicitud POST para actualizar el XML
app.post('/update', async (req, res) => {
    console.log('Solicitud POST entrante para actualizar el XML de los buses');

    try {
        await extractDataAndGenerateXML();
        res.status(200).send({ message: 'Solicitud recibida, XML de los buses se está actualizando.' });
    } catch (error) {
        console.error('Error al actualizar el XML:', error);
        res.status(500).send({ message: 'Error al actualizar el XML.' });
    }
});

// Manejo de la solicitud GET para /voice/:busKey
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