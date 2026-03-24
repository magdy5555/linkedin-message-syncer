const { PlaywrightCrawler } = require('crawlee');
const { Actor } = require('apify');

Actor.main(async () => {
    const input = await Actor.getInput();
    const {
        accountOwnerUrl,
        cookieString,
        proxy
    } = input;

    // --- التحقق من صحة المدخلات ---
    if (!accountOwnerUrl || !cookieString) {
        throw new Error('Both "accountOwnerUrl" and "cookieString" must be provided in the input.');
    }
    
    console.log('Inputs are valid. Creating proxy configuration...');
    const proxyConfiguration = await Actor.createProxyConfiguration(proxy);
    console.log('Proxy configuration created.');

    // --- إعداد الكوكيز بالشكل الصحيح ---
    // هذا هو الجزء الذي تم إصلاحه
    const cookies = cookieString.split(';').map(pair => {
        const [name, value] = pair.trim().split('=');
        return {
            name,
            value,
            domain: '.linkedin.com', // <--- تم التعديل: إضافة النطاق
            path: '/' // <--- تم التعديل: إضافة المسار للأفضل
        };
    });

    console.log('Starting the Playwright crawler to fetch the messaging page...');
    const crawler = new PlaywrightCrawler({
        proxyConfiguration,
        useSessionPool: true,
        persistCookiesPerSession: false, // نحن نستخدم الكوكيز من المدخلات مباشرة

        async requestHandler({ page, sendRequest }) {
            console.log('Navigating to the LinkedIn messaging page...');
            
            // أولاً، انتقل إلى أي صفحة في LinkedIn لضمان أن السياق (context) جاهز
            // هذا يمنع أحيانًا أخطاء إضافة الكوكيز
            await page.goto('https://www.linkedin.com/');
            
            // ثانياً، أضف الكوكيز إلى السياق
            await page.context().addCookies(cookies);
            console.log('Cookies added successfully.');

            // ثالثاً، انتقل إلى الصفحة المستهدفة
            await page.goto('https://www.linkedin.com/messaging/');
            
            // انتظر حتى يتم تحميل قائمة المحادثات
            console.log('Waiting for conversation list to load...');
            await page.waitForSelector('[data-control-name="conversation_list_item"]', { timeout: 30000 });

            console.log('Extracting conversation links...');
            const conversationUrls = await page.$$eval(
                '[data-control-name="conversation_list_item"] a',
                links => links.map(link => link.href)
            );

            console.log(`Found ${conversationUrls.length} conversations. Adding them to the queue.`);

            // أضف الروابط التي تم العثورها إلى قائمة الانتظار للزحف إليها لاحقًا
            for (const url of conversationUrls) {
                await crawler.addRequests([{
                    url: url,
                    userData: { label: 'CONVERSATION' }
                }]);
            }
        },

        // هذا المعالج سيعمل لكل محادثة على حدة
        async requestHandler({ page, request }) {
            if (request.userData.label === 'CONVERSATION') {
                const conversationUrl = request.url;
                console.log(`Processing conversation: ${conversationUrl}`);

                await page.goto(conversationUrl, { waitUntil: 'networkidle' });

                // انتظر حتى تظهر الرسائل
                await page.waitForSelector('.msg-s-message-list__event', { timeout: 30000 });

                const messages = await page.$$eval('.msg-s-message-list__event', (events, ownerUrl) => {
                    return events.map(event => {
                        const senderElement = event.querySelector('.msg-s-event__meta .msg-s-message-group__profile-link');
                        const timeElement = event.querySelector('.msg-s-event__meta time');
                        const textElement = event.querySelector('.msg-s-event__content p');

                        const senderUrl = senderElement ? senderElement.href : null;
                        const senderName = senderElement ? senderElement.innerText.trim() : null;
                        const timestamp = timeElement ? timeElement.getAttribute('aria-label') : null;
                        const text = textElement ? textElement.innerText.trim() : null;

                        // تحديد ما إذا كانت الرسالة واردة أم صادرة
                        const isOwnMessage = event.classList.contains('msg-s-sent-message-group');

                        return {
                            senderUrl,
                            senderName,
                            timestamp,
                            text,
                            isOwnMessage,
                            conversationUrl: ownerUrl,
                        };
                    });
                }, accountOwnerUrl); // تمرير الرابط كوسيط

                // حفظ البيانات في مجموعة البيانات الافتراضية
                await Actor.pushData(messages);
                console.log(`Saved ${messages.length} messages from ${conversationUrl}`);
            }
        },
    });

    // بدء الزحف بالطلب الأولي
    await crawler.run([{
        url: 'https://www.linkedin.com/messaging/',
        userData: { label: 'INIT' }
    }]);

    console.log('Crawler finished.');
});
