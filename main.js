// main.js - Using PlaywrightCrawler for better anti-bot bypass

import { Actor } from 'apify';
import { PlaywrightCrawler, log } from 'crawlee';

log.info('Actor script started.');

await Actor.init();

log.info('Actor initialized.');

try {
    const input = await Actor.getInput();
    log.info('Input received:', input);

    const { cookieString, accountOwnerUrl, proxy } = input;

    if (!cookieString || !accountOwnerUrl) {
        const errorMsg = `Missing inputs: cookieString: ${!!cookieString}, accountOwnerUrl: ${!!accountOwnerUrl}`;
        log.error(errorMsg);
        await Actor.pushData({ status: 'FAILED', message: errorMsg });
        await Actor.exit();
    }

    log.info('Inputs are valid. Creating proxy configuration...');
    const proxyConfiguration = await Actor.createProxyConfiguration(proxy);
    log.info('Proxy configuration created.');

    const crawler = new PlaywrightCrawler({
        proxyConfiguration,
        // Use headful mode to see the browser in action for debugging (set to true)
        // For production, keep it false.
        headless: false,
        launchContext: {
            launchOptions: {
                // Use a common user agent
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            },
        },
        requestHandler: async ({ page, sendRequest }) => {
            log.info('Navigating to the LinkedIn messaging page...');
            
            // Set cookies before navigating
            const cookies = cookieString.split('; ').map(c => {
                const [key, ...value] = c.split('=');
                return { name: key, value: value.join('='), domain: '.linkedin.com', url: 'https://www.linkedin.com' };
            });
            await page.context().addCookies(cookies);
            log.info('Cookies have been set in the browser context.');

            await page.goto('https://www.linkedin.com/messaging/', { waitUntil: 'networkidle' });
            log.info('Page loaded. Waiting for a moment to ensure all scripts are executed...');
            await page.waitForTimeout(3000); // Wait for 3 seconds

            // Use page.evaluate to run JavaScript inside the browser to find the token
            const csrfToken = await page.evaluate(() => {
                // This is the most reliable way to get the token
                return window.webpackJsonp ? Object.values(window.webpackJsonp).find(arr => arr?.[0]?.[0] === 'csrf-token')?.[0]?.[1] : null;
            });

            // Fallback if the above doesn't work
            const finalToken = csrfToken || await page.$eval('meta[name="csrf-token"]', el => el.content).catch(() => null);

            if (!finalToken) {
                const errorMsg = 'Could not find CSRF token even with a real browser. The cookies might be invalid or LinkedIn has changed its structure significantly.';
                log.error(errorMsg);
                // Take a screenshot for debugging
                await page.screenshot({ path: 'debug_screenshot.png', fullPage: true });
                await Actor.setValue('debug_screenshot.png', await page.screenshot({ fullPage: true }), { contentType: 'image/png' });
                log.error('A screenshot has been saved to Key-Value Store for inspection.');
                await Actor.pushData({ status: 'FAILED', message: errorMsg });
                return;
            }

            log.info(`Successfully extracted CSRF token: ${finalToken.substring(0, 10)}...`);

            // Step 2: Make the API call. Playwright can't directly make this call, so we use sendRequest
            log.info('Sending request to LinkedIn API with CSRF token and full cookies...');
            try {
                const response = await sendRequest({
                    url: 'https://www.linkedin.com/voyager/api/messaging/conversations?count=20&q=all',
                    method: 'GET',
                    responseType: 'json',
                    headers: {
                        'cookie': cookieString,
                        'csrf-token': finalToken,
                        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                        'accept': 'application/vnd.linkedin.normalized+json+2.1',
                        'x-restli-protocol-version': '2.0.0'
                    }
                });

                log.info(`Received response with status: ${response.status}`);

                if (!response.body || !response.body.elements) {
                    const errorMsg = `Invalid response body from LinkedIn. Response: ${JSON.stringify(response.body)}`;
                    log.error(errorMsg);
                    await Actor.pushData({ status: 'FAILED', message: errorMsg });
                    return;
                }

                const conversations = response.body.elements || [];
                log.info(`Found ${conversations.length} conversations.`);
                const results = [];

                for (const conv of conversations) {
                    const threadId = conv.entityUrn.split(':').pop();
                    const participants = conv.participants || [];
                    
                    const leadParticipant = participants.find(p => {
                        const memberUrn = p.messagingMemberUrn || '';
                        return !accountOwnerUrl.includes(memberUrn);
                    }) || participants[0];

                    const lastEvent = conv.lastMessage;
                    const senderUrn = lastEvent?.from?.messagingMemberUrn || '';
                    const isReply = !accountOwnerUrl.includes(senderUrn);

                    results.push({
                        threadId: threadId,
                        participant_name: `${leadParticipant.person?.firstName || ''} ${leadParticipant.person?.lastName || ''}`.trim(),
                        last_message_text: lastEvent?.eventContent?.attributedBody?.text || "Attachment/Media",
                        last_message_at: new Date(conv.lastActivityAt).toISOString(),
                        is_reply: isReply,
                        unread_count: conv.unreadCount,
                        is_read: conv.read,
                        conversation_url: `https://www.linkedin.com/messaging/thread/${threadId}/`
                    });
                }

                await Actor.pushData({
                    status: 'SUCCESS',
                    account_owner: accountOwnerUrl,
                    sync_at: new Date().toISOString(),
                    conversations_count: results.length,
                    data: results
                });

                log.info(`✅ Successfully synced ${results.length} conversations.`);

            } catch (error) {
                log.error(`❌ API request failed: ${error.message}`);
                await Actor.pushData({ status: 'FAILED', message: `API request failed: ${error.message}` });
            }
        },
    });

    log.info('Starting the Playwright crawler to fetch the messaging page...');
    await crawler.run(['https://www.linkedin.com/messaging/']);
    log.info('Crawler finished.');

} catch (error) {
    log.error(`❌ A critical error occurred: ${error.message}`);
    await Actor.pushData({ status: 'FAILED', message: `Critical error: ${error.message}` });
} finally {
    log.info('Exiting actor...');
    await Actor.exit();
}
