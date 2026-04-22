require('dotenv').config();
const mysql = require("mysql");
const axios = require("axios");
const cheerio = require("cheerio");
const puppeteer = require('puppeteer');
const { Cluster } = require('puppeteer-cluster');

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
      
      await ownPage.setViewport({ width: 1920, height: 1080 });
      await ownPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      if (!url || typeof url !== 'string' || !url.startsWith('http')) {
        throw new Error('URL inválida o vacía');
      }

      await ownPage.goto(url, { 
        waitUntil: 'domcontentloaded', 
        timeout: 45000 
      });
      
      // Selectores comunes para precio en Cyberpuerta (incluyendo los nuevos formatos)
      const priceSelector = '.priceText, span.price, .detailsInfo .price, h2.cp-text--heading-1, h2.cpd-text--heading-1, .cp-price, .cpd-price';
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
      
      await ownPage.setViewport({ width: 1920, height: 1080 });
      await ownPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
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
      
      await ownPage.setViewport({ width: 1920, height: 1080 });
      await ownPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
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
      
      await ownPage.setViewport({ width: 1920, height: 1080 });
      await ownPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
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
        waitUntil: 'domcontentloaded', 
        timeout: 45000 
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
async function procesarConLimite(items, tienda, limite = 15) {
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
      '--window-size=1280,720' // Tamaño reducido para menor consumo
    ]
  };

  if (process.env.CHROME_PATH) {
    launchOptions.executablePath = process.env.CHROME_PATH;
  }

  const cluster = await Cluster.launch({
    concurrency: Cluster.CONCURRENCY_PAGE, // Usar pestañas en lugar de procesos independientes para ahorrar CPU/RAM
    maxConcurrency: 2, // Reducido a 2 para proteger el hardware (ideal para N95/MiniPCs)
    puppeteerOptions: launchOptions,
    timeout: 120000 
  });

  await cluster.task(async ({ page, data: componente }) => {
    // Pequeño respiro entre tareas para no estresar el CPU
    await new Promise(r => setTimeout(r, 500));
    
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
      // Esperar 3 segundos entre tiendas para que el CPU se enfríe
      await new Promise(r => setTimeout(r, 3000));
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
