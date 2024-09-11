// Cargar las variables de entorno desde un archivo .env
require('dotenv').config();

const express = require('express');
const axios = require('axios');
const xmlbuilder = require('xmlbuilder');

const app = express();
app.use(express.json()); // Para manejar el cuerpo de solicitudes POST

let latestXml = null; // Variable para almacenar el XML generado

// Función para obtener el token de autenticación
async function getAuthToken() {
    try {
        const response = await axios.post('https://apiavl.easytrack.com.uy/sessions/auth/', {
            username: process.env.API_USERNAME, // Usar variables de entorno para mayor seguridad
            password: process.env.API_PASSWORD
        });
        return response.data.jwt; // Devuelve el token JWT
    } catch (error) {
        console.error('Error al obtener el token:', error);
        throw error;
    }
}

// Función para obtener las posiciones de los vehículos
async function getVehiclePositions(token) {
    try {
        const response = await axios.get('https://apiavl.easytrack.com.uy/positions', {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });
        return response.data; // Retorna un array de posiciones
    } catch (error) {
        console.error('Error al obtener las posiciones:', error);
        throw error;
    }
}

// Función para generar el XML basado en los datos obtenidos
function generateXML(positionData) {
    const position = positionData.length > 0 ? positionData[0].position : 'No se pudo obtener la posición';
    const xml = xmlbuilder.create('Response')
        .ele('Say', { voice: 'Polly.Andres-Neural', language: "es-MX" }, `El bus se encuentra en ${position}`)
        .end({ pretty: true });
    return xml;
}

// Función principal para autenticar y obtener los datos, y luego generar el XML
async function extractDataAndGenerateXML() {
    try {
        // Obtener el token
        const token = await getAuthToken();

        // Obtener las posiciones de los vehículos
        const positions = await getVehiclePositions(token);

        // Generar el XML con la posición obtenida
        latestXml = generateXML(positions);

        console.log('XML generado:\n', latestXml);
    } catch (error) {
        console.error('Error al extraer datos y generar XML:', error);
    }
}

// Manejo de la solicitud POST para actualizar el XML
app.post('/update', async (req, res) => {
    console.log('Solicitud POST entrante para actualizar el XML');

    try {
        await extractDataAndGenerateXML();
        res.status(200).send({ message: 'Solicitud recibida, XML actualizado.' });
    } catch (error) {
        console.error('Error al actualizar el XML:', error);
        res.status(500).send({ message: 'Error al actualizar el XML.' });
    }
});

// Manejo de la solicitud GET para /voice
app.get('/voice', (req, res) => {
    console.log('Solicitud entrante a /voice');

    if (latestXml) {
        res.type('application/xml');
        res.send(latestXml);
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