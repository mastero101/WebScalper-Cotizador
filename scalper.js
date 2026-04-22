require('dotenv').config();
const mysql = require("mysql");
const axios = require("axios");
const cheerio = require("cheerio");
let puppeteer;
try {
  // Intentar usar puppeteer-extra con stealth si está instalado
  const puppeteerExtra = require('puppeteer-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteerExtra.use(StealthPlugin());
  puppeteer = puppeteerExtra;
} catch (e) {
  // Fallback al puppeteer estándar si no están los plugins
  puppeteer = require('puppeteer');
}
const { Cluster } = require('puppeteer-cluster');
const os = require('os');
const fs = require('fs');

// Función para obtener temperatura del CPU (Linux)
const getCpuTemp = () => {
  try {
    // Intentar leer la zona térmica 0 (común en Ubuntu/Debian)
    const temp = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8');
    return parseInt(temp) / 1000;
  } catch (e) {
    return null; // Fallback si no es Linux o no hay sensores
  }
};

// Configurar el pool de conexión a la base de datos para mejor rendimiento
const pool = mysql.createPool({
  connectionLimit: 10,
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  ssl: process.env.DB_SSL === 'true'
});

// Convertir query a Promise usando el pool
const queryAsync = (sql, values) => {
  return new Promise((resolve, reject) => {
    pool.query(sql, values, (error, results) => {
      if (error) reject(error);
      else resolve(results);
    });
  });
};

// Funciones de scraping específicas por tienda
const scrapingMethods = {
  Cyberpuerta: async (url, page) => {
    let browser = null;
    let ownPage = page;
    
    try {
      if (!ownPage) {
        const launchOptions = {
          headless: true,
          args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
          ]
        };
        
        // Solo agregar executablePath si está definido en .env
        if (process.env.CHROME_PATH) {
          launchOptions.executablePath = process.env.CHROME_PATH;
        }
        
        browser = await puppeteer.launch(launchOptions);
        ownPage = await browser.newPage();
      }
      
      await ownPage.setViewport({ 
        width: 1280 + Math.floor(Math.random() * 50), 
        height: 720 + Math.floor(Math.random() * 50) 
      });
      
      await ownPage.setExtraHTTPHeaders({
        'Accept-Language': 'es-MX,es;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="122", "Google Chrome";v="122"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
      });

      await ownPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
      
      // Ahorro de recursos: Bloquear imágenes y fuentes
      try { await ownPage.setRequestInterception(true); } catch (e) {}
      const requestHandler = (req) => {
        if (['image', 'font', 'media'].includes(req.resourceType())) {
          req.abort();
        } else {
          req.continue();
        }
      };
      ownPage.on('request', requestHandler);
      
      if (!url || typeof url !== 'string' || !url.startsWith('http')) {
        throw new Error('URL inválida o vacía');
      }

      await ownPage.goto(url, { 
        waitUntil: 'networkidle2', 
        timeout: 60000 
      });

      // Detectar y esperar a Cloudflare si es necesario
      let title = await ownPage.title();
      if (title.includes('Just a moment')) {
        console.log(`[Cyberpuerta] Detectado Cloudflare en ${url}. Esperando validación...`);
        // Esperar hasta 15 segundos a que el título cambie o el selector aparezca
        try {
          await ownPage.waitForFunction(
            () => !document.title.includes('Just a moment'),
            { timeout: 15000 }
          );
        } catch (e) {
          console.log('[Cyberpuerta] Timeout esperando a que Cloudflare desaparezca.');
        }
      }
      
      // Selectores comunes para precio en Cyberpuerta (incluyendo los nuevos formatos)
      const priceSelector = '.priceText, span.price, .detailsInfo .price, h2.cp-text--heading-1, h2.cpd-text--heading-1, .cp-price, .cpd-price';
      await ownPage.waitForSelector(priceSelector, { timeout: 20000 });
      
      const priceText = await ownPage.$eval(priceSelector, el => el.textContent.trim());
      const price = priceText.replace(/[$,]/g, '').split('.')[0];
      
      return price;
    } catch (error) {
      const title = ownPage ? await ownPage.title().catch(() => 'N/A') : 'N/A';
      console.error(`Error procesando componente Cyberpuerta: ${error.message} | Page Title: ${title}`);
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  },
  
  Pcel: async (url, page) => {
    let browser = null;
    let ownPage = page;
    
    try {
      if (!ownPage) {
        const launchOptions = {
          headless: true,
          args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
          ]
        };
        
        if (process.env.CHROME_PATH) {
          launchOptions.executablePath = process.env.CHROME_PATH;
        }
        
        browser = await puppeteer.launch(launchOptions);
        ownPage = await browser.newPage();
      }
      
      await ownPage.setViewport({ width: 1280, height: 720 });
      await ownPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
      
      // Solo habilitar si no estaba habilitado antes (evitar errores de doble activación)
      try { await ownPage.setRequestInterception(true); } catch (e) {}
      
      const requestHandler = (req) => {
        if (req.resourceType() === 'image' || req.resourceType() === 'stylesheet') {
          req.abort();
        } else {
          req.continue();
        }
      };
      
      ownPage.on('request', requestHandler);
      
      if (!url || typeof url !== 'string' || !url.startsWith('http')) {
        throw new Error('URL inválida o vacía');
      }

      await ownPage.goto(url, { 
        waitUntil: 'domcontentloaded', 
        timeout: 20000 
      });
      
      await ownPage.waitForSelector('div.vatprice_top strong', { timeout: 10000 });
      
      const priceText = await ownPage.$eval('div.vatprice_top strong', el => el.textContent.trim());
      const price = priceText.replace(/[$,]/g, '').split('.')[0];
      
      // Limpiar el listener para no interferir con otros usos de la misma página si viene de un cluster
      ownPage.off('request', requestHandler);
      
      return price;
    } catch (error) {
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  },
  
  Aliexpress: async (url, page) => {
    let browser = null;
    let ownPage = page;
    
    try {
      if (!ownPage) {
        const launchOptions = {
          headless: true,
          args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
          ]
        };
        
        if (process.env.CHROME_PATH) {
          launchOptions.executablePath = process.env.CHROME_PATH;
        }
        
        browser = await puppeteer.launch(launchOptions);
        ownPage = await browser.newPage();
      }
      
      await ownPage.setViewport({ width: 1280, height: 720 });
      await ownPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
      
      try { await ownPage.setRequestInterception(true); } catch (e) {}
      
      const requestHandler = (req) => {
        if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
          req.abort();
        } else {
          req.continue();
        }
      };
      
      ownPage.on('request', requestHandler);
      
      if (!url || typeof url !== 'string' || !url.startsWith('http')) {
        throw new Error('URL inválida o vacía');
      }

      await ownPage.goto(url, { 
        waitUntil: 'domcontentloaded', 
        timeout: 40000 
      });
      
      // Uso de selector parcial para Aliexpress ya que las clases cambian frecuentemente
      const priceSelector = '[class*="price--currentPriceText"], .product-price-value, .price--priceText--, .current-price';
      await ownPage.waitForSelector(priceSelector, { timeout: 30000 });
      
      const priceText = await ownPage.$eval(priceSelector, el => el.textContent.trim());
      // Limpiar texto de forma más robusta
      const price = priceText.replace(/[MX$,\s\u00A0]/g, '').replace(',', '.').split('.')[0];
      
      ownPage.off('request', requestHandler);
      
      return price;
    } catch (error) {
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  },
  
  Amazon: async (url, page) => {
    let browser = null;
    let ownPage = page;
    
    try {
      if (!ownPage) {
        const launchOptions = {
          headless: true,
          args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
          ]
        };
        
        if (process.env.CHROME_PATH) {
          launchOptions.executablePath = process.env.CHROME_PATH;
        }
        
        browser = await puppeteer.launch(launchOptions);
        ownPage = await browser.newPage();
      }
      
      await ownPage.setViewport({ width: 1280, height: 720 });
      await ownPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
      
      if (!url || typeof url !== 'string' || !url.startsWith('http')) {
        throw new Error('URL inválida o vacía');
      }

      await ownPage.goto(url, { 
        waitUntil: 'domcontentloaded', 
        timeout: 40000 
      });
      
      await ownPage.waitForSelector('.a-price-whole', { timeout: 15000 });
      const priceText = await ownPage.$eval('.a-price-whole', el => el.textContent.trim());
      const price = priceText.replace(/[,$]/g, '');
      
      if (price && !isNaN(price)) {
        return price;
      }
      
      throw new Error('Precio no encontrado');
    } catch (error) {
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  },
  
  Ddtech: async (url, page) => {
    let browser = null;
    let ownPage = page;
    
    try {
      if (!ownPage) {
        const launchOptions = {
          headless: true,
          args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
          ]
        };
        
        if (process.env.CHROME_PATH) {
          launchOptions.executablePath = process.env.CHROME_PATH;
        }
        
        browser = await puppeteer.launch(launchOptions);
        ownPage = await browser.newPage();
      }
      
      await ownPage.setViewport({ width: 1280, height: 720 });
      await ownPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      if (!url || typeof url !== 'string' || !url.startsWith('http')) {
        throw new Error('URL inválida o vacía');
      }

      await ownPage.goto(url, { 
        waitUntil: 'networkidle2', 
        timeout: 60000 
      });
      
      // Selector actualizado para DDtech basado en feedback
      const priceSelector = '.price-box .price, .product-info-price .price, .product-price, #form-p-price';
      await ownPage.waitForSelector(priceSelector, { timeout: 20000 });
      
      const priceText = await ownPage.$eval(priceSelector, el => el.textContent.trim());
      const price = priceText.replace(/[$,]/g, '').split('.')[0];
      
      return price;
    } catch (error) {
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  },

  Default: async (url) => {
    try {
      const response = await axios.get(url, { timeout: 15000 });
      const $ = cheerio.load(response.data);
      // Intenta encontrar selectores de precio genéricos
      const priceText = $(".price, .product-price, [class*='price']").first().text().trim();
      return priceText.replace(/[$,]/g, '').split('.')[0];
    } catch (error) {
      throw error;
    }
  },
  
  AmazonOldAxios: async (url) => {
    try {
      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      
      const $ = cheerio.load(response.data);
      const priceText = $(".a-price-whole").text();
      const priceValues = priceText.split('.');
      const firstPriceValue = priceValues[0];
      const price = firstPriceValue.replace(/[,$]/g, '');
      
      if (price && !isNaN(price)) {
        return price;
      }
      
      throw new Error('Precio no encontrado');
      
    } catch (error) {
      console.error(`Error en Amazon scraping: ${error.message || error}`);
      throw error;
    }
  }
};

// Actualizar la función de normalización de tiendas
const normalizarNombreTienda = (tienda) => {
  const tiendaNormalizada = tienda.toLowerCase();
  
  const mapeoTiendas = {
    'pcel': 'Pcel',
    'PCEL': 'Pcel',
    'cyberpuerta': 'Cyberpuerta',
    'aliexpress': 'Aliexpress',
    'amazon': 'Amazon',
    'amazon.com.mx': 'Amazon',
    'amazon.mx': 'Amazon',
    'ddtech': 'Ddtech',
    'DDTECH': 'Ddtech'
  };

  return mapeoTiendas[tiendaNormalizada] || tienda;
};

// Función de concurrencia de "ventana deslizante" (mucho más rápida que los lotes fijos)
async function procesarConLimite(items, tienda, limite = process.env.CONCURRENCY || 15) {
  const activePromises = new Set();
  
  for (const componente of items) {
    // Si alcanzamos el límite, esperamos a que al menos una termine
    if (activePromises.size >= limite) {
      await Promise.race(activePromises);
    }

    const promise = (async () => {
      try {
        const price = await scrapingMethods[tienda](componente.url);
        if (price && !isNaN(price)) {
          const updateQuery = 'UPDATE componentes SET precio = ? WHERE id = ?';
          await queryAsync(updateQuery, [price, componente.id]);
          console.log(`[${componente.id}] ID: ${componente.id} (${tienda}) actualizado. Precio: ${price}`);
        }
      } catch (error) {
        console.error(`Error procesando componente ${componente.id}:`, error.message || error.code || error);
      }
    })();

    activePromises.add(promise);
    // Limpiar el SET cuando la promesa termine
    promise.finally(() => activePromises.delete(promise));
    
    // Pequeño delay de 50ms para no saturar el stack de red instantáneamente
    await new Promise(r => setTimeout(r, 50));
  }

  // Esperar a que terminen las últimas
  await Promise.all(activePromises);
}

// Función para procesar tiendas que usan Puppeteer
async function procesarConCluster(items, tienda) {
  const launchOptions = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,720',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    ]
  };

  if (process.env.CHROME_PATH) {
    launchOptions.executablePath = process.env.CHROME_PATH;
  }

  // Priorizar el valor de .env, pero mantener Cyberpuerta en 1 por defecto si no se especifica
  const envConcurrency = parseInt(process.env.CONCURRENCY) || 2;
  const maxConcurrency = (tienda === 'Cyberpuerta' && !process.env.CONCURRENCY) ? 1 : envConcurrency;

  const cluster = await Cluster.launch({
    concurrency: Cluster.CONCURRENCY_PAGE,
    maxConcurrency: maxConcurrency, 
    puppeteerOptions: launchOptions,
    timeout: 150000 
  });

  // Si es Cyberpuerta, hacer un "warm up" (visitar home para obtener cookies)
  if (tienda === 'Cyberpuerta') {
    await cluster.execute('https://www.cyberpuerta.mx/', async ({ page }) => {
      console.log("[Cyberpuerta] Realizando 'warm-up' en el home...");
      await page.goto('https://www.cyberpuerta.mx/', { waitUntil: 'networkidle2', timeout: 60000 });
      await new Promise(r => setTimeout(r, 2000));
    });
  }

  await cluster.task(async ({ page, data: componente }) => {
    // Delay aleatorio entre 2 y 5 segundos para parecer más humano
    const delay = Math.floor(Math.random() * 3000) + 2000;
    await new Promise(r => setTimeout(r, delay));
    
    try {
      // Pasamos la página del cluster al método de scraping para reutilizar el navegador
      const price = await scrapingMethods[tienda](componente.url, page);
      
      if (price && !isNaN(price)) {
        const updateQuery = 'UPDATE componentes SET precio = ? WHERE id = ?';
        await queryAsync(updateQuery, [price, componente.id]);
        console.log(`[${componente.id}] ID: ${componente.id} (${tienda}) actualizado. Precio: ${price}`);
      }
    } catch (error) {
      console.error(`Error procesando componente ${componente.id}:`, error.message || error.code || error);
    }
  });

  for (const item of items) {
    await cluster.queue(item);
  }

  await cluster.idle();
  await cluster.close();
}

// Función principal actualizarPrecios
async function actualizarPrecios() {
  try {
    const query = 'SELECT id, url, tienda, precio FROM componentes';
    const componentes = await queryAsync(query);
    console.log("Número de registros obtenidos: ", componentes.length);

    const componentesPorTienda = componentes.reduce((acc, comp) => {
      const tiendaNormalizada = normalizarNombreTienda(comp.tienda);
      if (!acc[tiendaNormalizada]) acc[tiendaNormalizada] = [];
      acc[tiendaNormalizada].push({...comp, tienda: tiendaNormalizada});
      return acc;
    }, {});

    // Procesar tiendas de forma SECUENCIAL para no sobrecalentar el CPU
    for (const [tienda, items] of Object.entries(componentesPorTienda)) {
      
      // --- PROTECCIÓN TÉRMICA ---
      const thermalLimit = parseFloat(process.env.THERMAL_LIMIT) || 0.8;
      const tempLimit = parseInt(process.env.TEMP_LIMIT) || 75; // 75°C por defecto
      
      const cpuCount = os.cpus().length;
      let load = os.loadavg()[0] / cpuCount;
      let temp = getCpuTemp();
      
      if (temp !== null && temp > tempLimit) {
        console.log(`\n[PROTECCIÓN TÉRMICA] Temperatura alta (${temp.toFixed(1)}°C). Esperando 45s a que enfríe...`);
        await new Promise(r => setTimeout(r, 45000));
      } else if (load > thermalLimit) {
        console.log(`\n[PROTECCIÓN TÉRMICA] Carga CPU alta (${(load*100).toFixed(1)}%). Esperando 30s a que enfríe...`);
        await new Promise(r => setTimeout(r, 30000));
      }

      console.log(`\n--- Iniciando procesamiento de tienda: ${tienda} (${items.length} items) ---`);
      
      try {
        if (['Amazon', 'Pcel', 'Aliexpress', 'Cyberpuerta', 'Ddtech'].includes(tienda)) {
          await procesarConCluster(items, tienda);
        } else if (scrapingMethods[tienda]) {
          // Si existe el método pero no es Puppeteer
          await procesarConLimite(items, tienda, 5);
        } else {
          // Fallback para tiendas sin método definido
          console.log(`Tienda ${tienda} no tiene método específico, usando scraper genérico...`);
          await procesarConLimite(items, 'Default', 3);
        }
      } catch (error) {
        console.error(`Error procesando tienda ${tienda}:`, error.message);
      }
      
      console.log(`Finalizado procesamiento de tienda: ${tienda}`);
      // Esperar 10 segundos entre tiendas para que el CPU se enfríe (Protección Térmica)
      await new Promise(r => setTimeout(r, 10000));
    }
  } catch (error) {
    console.error("Error en el proceso principal:", error);
  }
}

// Iniciar el proceso
(async () => {
  console.log("Iniciando conexión a la base de datos...");
  try {
    // Al usar pool, no necesitamos llamar a .connect() manualmente,
    // pero podemos hacer una consulta de prueba para verificar la conexión.
    await queryAsync('SELECT 1');
    console.log("Conexión exitosa a la base de datos");
    
    await actualizarPrecios();
    console.log("Proceso de actualización completado exitosamente.");
  } catch (err) {
    console.error("Error crítico durante el proceso:", err);
  } finally {
    console.log("Cerrando recursos y base de datos...");
    try {
      await new Promise((resolve) => {
        pool.end(() => {
          console.log("Conexión a base de datos cerrada.");
          resolve();
        });
      });
    } catch (e) {
      console.error("Error cerrando el pool:", e);
    }
    console.log("¡Hecho!");
    process.exit(0);
  }
})();

// Manejadores de errores globales para evitar cierres inesperados sin info
process.on('unhandledRejection', (reason, promise) => {
  console.error('--- EXCEPCIÓN NO CONTROLADA (Promesa) ---');
  console.error('Razón:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('--- ERROR CRÍTICO DEL SISTEMA ---');
  console.error(err);
  // En errores críticos de sistema, cerramos pool y salimos tras loggear
  pool.end(() => process.exit(1));
});
