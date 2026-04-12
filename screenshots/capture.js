const puppeteer = require('puppeteer');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

  const URL = 'http://localhost:3000/preview/';
  await page.goto(URL, { waitUntil: 'networkidle0' });

  // 1. Login Screen
  await page.screenshot({ path: '/home/user/root0314/screenshots/01-login.jpg', type: 'jpeg', quality: 90 });
  console.log('✓ 01-login.jpg');

  // 2. Register tab
  await page.evaluate(() => switchTab('register'));
  await delay(300);
  await page.screenshot({ path: '/home/user/root0314/screenshots/02-register.jpg', type: 'jpeg', quality: 90 });
  console.log('✓ 02-register.jpg');

  // 3. Chat list (navigate directly)
  await page.evaluate(() => {
    currentUser = { id: '1', phone: '+25779000001', displayName: 'Fiston' };
    loadChatList();
    showScreen('chatListScreen');
  });
  await delay(300);
  await page.screenshot({ path: '/home/user/root0314/screenshots/03-chatlist.jpg', type: 'jpeg', quality: 90 });
  console.log('✓ 03-chatlist.jpg');

  // 4. Open a chat
  await page.evaluate(() => openChat('1', 'Alice Niyonzima', true));
  await delay(300);
  await page.screenshot({ path: '/home/user/root0314/screenshots/04-chat.jpg', type: 'jpeg', quality: 90 });
  console.log('✓ 04-chat.jpg');

  // 5. Send a message and get reply
  await page.type('#msgInput', 'Amahoro! Buchat ni vyiza!');
  await page.click('.send-btn');
  await delay(2000);
  await page.screenshot({ path: '/home/user/root0314/screenshots/05-chat-messages.jpg', type: 'jpeg', quality: 90 });
  console.log('✓ 05-chat-messages.jpg');

  // 6. Call screen
  await page.evaluate(() => startCall('audio'));
  await delay(2500);
  await page.screenshot({ path: '/home/user/root0314/screenshots/06-call.jpg', type: 'jpeg', quality: 90 });
  console.log('✓ 06-call.jpg');

  await browser.close();
  console.log('\nDone! All 6 screenshots saved.');
})();
