// main.js - Final Version with ES Module fix

import { Actor } from 'apify';
import { CheerioCrawler, log } from 'crawlee';

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

    const crawler = new CheerioCrawler({
        proxyConfiguration,
        // The $ object is provided by CheerioCrawler automatically
        requestHandler: async ({ sendRequest, body, $ }) => {
            log.info(`Processing messaging page to extract CSRF token.`);

            // Step 1: Extract CSRF Token from the page's script tags.
            let csrfToken = null;
            const csrfRegex = /["']csrfToken["']\s*:\s*["']([^"']+)["']/;
            const match = body.match(csrfRegex);

            if (match && match[1]) {
                csrfToken = match[1];
                log.info('Successfully extracted CSRF token from page script.');
            } else {
                // Fallback: Use the provided $ object to search the HTML
                csrfToken = $('meta[name="csrf-token"]').attr('content');
                if (csrfToken) {
                     log.info('Successfully extracted CSRF token from meta tag.');
                }
            }

            if (!csrfToken) {
                const errorMsg = 'Could not find CSRF token on the page. LinkedIn may have changed its structure or the cookies are invalid/expired.';
                log.error(errorMsg);
                await Actor.pushData({ status: 'FAILED', message: errorMsg });
                return;
            }

            // Step 2: Make the API call with the full cookie string and CSRF token.
            log.info('Sending request to LinkedIn API with CSRF token and full cookies...');
            try {
                const response = await sendRequest({
                    url: 'https://www.linkedin.com/voyager/api/messaging/conversations?count=20&q=all',
                    method: 'GET',
                    responseType: 'json',
                    headers: {
                        'cookie': cookieString,
                        'csrf-token': csrfToken,
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

    log.info('Starting the crawler to fetch the messaging page...');
    await crawler.run(['https://www.linkedin.com/messaging/']);
    log.info('Crawler finished.');

} catch (error) {
    log.error(`❌ A critical error occurred: ${error.message}`);
    await Actor.pushData({ status: 'FAILED', message: `Critical error: ${error.message}` });
} finally {
    log.info('Exiting actor...');
    await Actor.exit();
}
