import { createServer, IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import lighthouse from 'lighthouse';
import puppeteer from 'puppeteer';
import axios from 'axios';

interface LighthouseRequest {
  url: string;
  options?: any;
}

const PORT = process.env.PORT || 3001;
const API_URL = process.env.API_URL || 'http://localhost:3000';

async function executeLighthouse(url: string, options: any = {}) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const runnerResult = await lighthouse(url, {
      port: Number(new URL(browser.wsEndpoint()).port),
      output: 'json',
      onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
      ...options
    });
    
    const lhr = runnerResult && 'lhr' in runnerResult ? runnerResult.lhr : undefined;
    return lhr;
  } finally {
    await browser.close();
  }
}

async function sendResultsToAPI(testId: string, results: any) {
  try {
    // Log détaillé des résultats
    console.log('📊 Résultats Lighthouse pour', testId, ':');
    console.log('URL testée:', results.finalUrl || results.requestedUrl);
    console.log('Scores:');
    
    if (results.categories) {
      Object.entries(results.categories).forEach(([category, data]: [string, any]) => {
        const score = Math.round((data.score || 0) * 100);
        const emoji = score >= 90 ? '🟢' : score >= 50 ? '🟡' : '🔴';
        console.log(`  ${emoji} ${category}: ${score}/100`);
      });
    }
    
    // Métriques importantes
    const fcp = results.audits?.['first-contentful-paint']?.displayValue || 'N/A';
    const lcp = results.audits?.['largest-contentful-paint']?.displayValue || 'N/A';
    const totalSize = results.audits?.['total-byte-weight']?.displayValue || 'N/A';
    
    console.log('⚡ Métriques de performance:');
    console.log(`  First Contentful Paint: ${fcp}`);
    console.log(`  Largest Contentful Paint: ${lcp}`);
    console.log(`  Taille totale: ${totalSize}`);
    console.log('---');

    // Envoi à l'API
    await axios.post(`${API_URL}/api/lighthouse/results`, {
      testId,
      results,
      timestamp: new Date().toISOString()
    });
    
    console.log('✅ Résultats envoyés avec succès à l\'API');
  } catch (error) {
    console.error('❌ Erreur lors de l\'envoi des résultats à l\'API:', error);
  }
}

function parseJSONBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function sendJSONResponse(res: ServerResponse, data: any, statusCode: number = 200) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url!, `http://${req.headers.host}`);
  const path = url.pathname;

  try {
    if (req.method === 'POST' && path === '/analyze') {
      const body: LighthouseRequest = await parseJSONBody(req);
      
      if (!body.url) {
        return sendJSONResponse(res, { error: 'URL requise' }, 400);
      }

      // Validation de l'URL
      try {
        new URL(body.url);
      } catch {
        return sendJSONResponse(res, { error: 'URL invalide' }, 400);
      }

      const testId = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      console.log('🚀 Démarrage du test Lighthouse pour:', body.url, '(ID:', testId, ')');
      
      // Réponse immédiate avec l'ID du test
      sendJSONResponse(res, { 
        id: testId, 
        status: 'pending',
        message: 'Test Lighthouse en cours...'
      });

      // Exécution asynchrone de Lighthouse
      executeLighthouse(body.url, body.options)
        .then(results => {
          console.log('🎯 Test Lighthouse terminé pour', testId);
          sendResultsToAPI(testId, results);
        })
        .catch(error => {
          console.error('❌ Erreur Lighthouse pour', testId, ':', error.message);
        });

    } else if (req.method === 'GET' && path === '/health') {
      sendJSONResponse(res, { 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        service: 'Lighthouse Microservice'
      });

    } else {
      sendJSONResponse(res, { 
        error: 'Endpoint non trouvé',
        availableEndpoints: [
          'POST /analyze - Lancer un test Lighthouse',
          'GET /health - Vérification de santé'
        ]
      }, 404);
    }

  } catch (error) {
    console.error('❌ Erreur serveur:', error);
    sendJSONResponse(res, { error: 'Erreur interne du serveur' }, 500);
  }
});

server.listen(PORT, () => {
  console.log('🚀 Microservice Lighthouse démarré sur le port', PORT);
  console.log('📊 Endpoint d\'analyse: POST http://localhost:' + PORT + '/analyze');
  console.log('💚 Endpoint de santé: GET http://localhost:' + PORT + '/health');
  console.log('🔗 API cible:', API_URL);
  console.log('---');
});

// Gestion propre de l'arrêt
process.on('SIGTERM', () => {
  console.log('🛑 Arrêt du microservice Lighthouse...');
  server.close(() => {
    console.log('✅ Microservice arrêté proprement');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 Arrêt du microservice Lighthouse...');
  server.close(() => {
    console.log('✅ Microservice arrêté proprement');
    process.exit(0);
  });
});