require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer');
const xmlbuilder = require('xmlbuilder');

const app = express();
app.use(express.json());

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

async function extractDataForBus(page, busKey, busMatricula) {
  // Función para buscar la matrícula y extraer la dirección
  async function findBusData() {
    try {
      console.log(`Buscando la matrícula ${busMatricula}...`);

      // Localizar el div cuyo textContent coincida con la matrícula
      const busDiv = await page.$x(`//div[contains(text(), '${busMatricula}')]`);
      if (busDiv.length === 0) {
        console.log(`No se encontró la matrícula ${busMatricula}.`);
        return { success: false, text: '' };
      }

      // Subir al div padre y luego bajar al último div hijo para encontrar la dirección
      const parentDiv = await page.evaluateHandle(el => el.parentElement, busDiv[0]);
      const addressDiv = await parentDiv.evaluateHandle(el => el.lastElementChild);
      const address = await page.evaluate(el => el.textContent.trim(), addressDiv);

      console.log(`Dirección encontrada para ${busMatricula}: ${address}`);
      return { success: true, text: address };
    } catch (error) {
      console.error(`Error buscando la dirección para ${busMatricula}:`, error);
      return { success: false, text: '' };
    }
  }

  let result = await findBusData();
  if (result.success) {
    // Generar el XML si se encuentra la dirección
    const xml = xmlbuilder.create('Response')
      .ele('Say', { voice: 'Polly.Andres-Neural', language: "es-MX" }, result.text)
      .end({ pretty: true });
    latestXml[busKey] = xml;
  }
  return result.success;
}

async function extractDataAndGenerateXML() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
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
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 });

    // Primero, buscar en la URL principal
    console.log('Navegando a la URL del dashboard...');
    await page.goto('https://avl.easytrack.com.ar/dashboard/1000', { waitUntil: 'domcontentloaded' });

    const notFoundBuses = [];

    // Buscar las matrículas de los buses
    for (let busKey in buses) {
      const success = await extractDataForBus(page, busKey, buses[busKey]);
      if (!success) {
        notFoundBuses.push(busKey); // Si no se encuentra, agregar a la lista para la segunda URL
      }
    }

    // Si no se encuentran todas las matrículas en la primera URL, buscar en la segunda
    if (notFoundBuses.length > 0) {
      console.log('Algunas matrículas no fueron encontradas. Navegando a la segunda URL...');
      await page.goto('https://avl.easytrack.com.ar/dashboard/1007', { waitUntil: 'domcontentloaded' });

      for (let busKey of notFoundBuses) {
        await extractDataForBus(page, busKey, buses[busKey]);
      }
    }
  } catch (error) {
    console.error('Error al extraer los datos:', error);
  } finally {
    console.log('Cerrando el navegador...');
    await browser.close();
  }
}

// Manejo de la solicitud POST para actualizar el XML
app.post('/update', async (req, res) => {
  console.log('Solicitud POST entrante para actualizar los XML de todos los buses');
  try {
    await extractDataAndGenerateXML();
    res.status(200).send({ message: 'Solicitud recibida, XML se está actualizando.' });
  } catch (error) {
    console.error('Error al actualizar los XML:', error);
    res.status(500).send({ message: 'Error al actualizar los XML.' });
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