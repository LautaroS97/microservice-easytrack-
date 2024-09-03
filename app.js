// Cargar las variables de entorno desde un archivo .env
require('dotenv').config();

const express = require('express');
const puppeteer = require('puppeteer');
const xmlbuilder = require('xmlbuilder');

const app = express();

let latestXml = null; // Variable para almacenar el XML generado

async function extractDataAndGenerateXML() {
    let browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    let page = await browser.newPage();

    try {
        console.log('Navegando a la URL...');
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
            console.error('Fallo al intentar iniciar sesión con Enter. Intentando con el botón de inicio de sesión...', error);

            console.log('Intentando hacer clic en el botón de inicio de sesión...');
            await page.click('app-root app-login.ng-star-inserted #btn-login');

            console.log('Esperando la navegación después de hacer clic en el botón de inicio de sesión...');
            await page.waitForNavigation({ waitUntil: 'domcontentloaded' });
        }

        async function getDataFromDashboard(url) {
            console.log(`Navegando a la URL: ${url}`);
            await page.goto(url, { waitUntil: 'domcontentloaded' });

            const containerSelector = 'div.ag-cell-value[aria-colindex="7"][role="gridcell"]';
            console.log('Esperando el elemento que contiene el texto...');
            try {
                await page.waitForSelector(containerSelector, { timeout: 15000 });

                console.log('Extrayendo el texto del elemento...');
                const extractedText = await page.$eval(`${containerSelector} a`, element => element.textContent.trim());

                console.log('Texto extraído:', extractedText);

                const truncatedText = extractedText.split(',').slice(0, 2).join(',');
                console.log('Texto truncado:', truncatedText);

                return { success: true, text: truncatedText };
            } catch (error) {
                console.error('No se encontró el bus en circulación.');
                return { success: false, text: '' };
            }
        }

        let result = await getDataFromDashboard('https://avl.easytrack.com.ar/dashboard/1000');
        if (!result.success) {
            result = await getDataFromDashboard('https://avl.easytrack.com.ar/dashboard/1007');
            if (!result.success) {
                console.log('Recargando el navegador y esperando 60 segundos...');
                await page.reload({ waitUntil: ['domcontentloaded'] });
                await page.waitForTimeout(15000);
                result = await getDataFromDashboard('https://avl.easytrack.com.ar/dashboard/1007');
            }

            if (result.success) {
                result.text = `El bus se encuentra detenido en ${result.text}`;
            }
        } else {
            result.text = `El bus se encuentra en ${result.text}`;
        }

        if (result.success) {
            console.log('Convirtiendo el texto a XML...');
            const xml = xmlbuilder.create('Response')
                .ele('Say', { voice: 'man', loop: 5 }, result.text)
                .end({ pretty: true });

            console.log('XML generado:\n', xml);

            // Guardar el XML en la variable global para que esté disponible en /voice
            latestXml = xml;
        } else {
            console.error('No se pudo obtener el dato de ninguna de las URLs.');
        }

    } catch (error) {
        console.error('Error al extraer el texto:', error);
    } finally {
        console.log('Cerrando el navegador...');
        await browser.close();
    }
}

// Función que se ejecuta periódicamente para actualizar el XML
async function updateXMLPeriodically() {
    while (true) {
        await extractDataAndGenerateXML();
        console.log('Esperando 20 minutos para la próxima actualización...');
        await new Promise(resolve => setTimeout(resolve, 20 * 60 * 1000));
    }
}

// Iniciar el proceso de actualización periódica
updateXMLPeriodically();

// Manejo de la solicitud GET para /voice
app.get('/voice', (req, res) => {
    console.log('Solicitud entrante a /voice');

    if (latestXml) {
        res.type('application/xml');
        res.send(latestXml);
    } else {
        // Generar un XML de error en caso de no tener datos recientes
        const xml = xmlbuilder.create('Response')
            .ele('Say', { voice: 'man', loop: 5 }, 'Lo sentimos, no se pudo obtener la información en este momento. Por favor, intente nuevamente más tarde.')
            .end({ pretty: true });

        res.type('application/xml');
        res.send(xml);
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Servidor escuchando en el puerto ${PORT}`);
});