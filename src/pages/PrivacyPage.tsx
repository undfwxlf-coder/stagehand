import LegalPageShell from "../components/LegalPageShell";

const CONTACT_EMAIL = "stagehand.studio@gmail.com";

export default function PrivacyPage() {
  return (
    <LegalPageShell title="Privacy Policy" effectiveDate="May 17, 2026">
      <p>
        This Privacy Policy explains what data Stagehand collects, why, and what we do with it. It
        applies to the Stagehand service operated by the Stagehand team ("we", "us"). The plain
        summary: <strong>we collect what we need to run the service, we don't sell or share your
        data, we don't train AI on your music, and we don't advertise.</strong>
      </p>

      <h2>1. Data we collect</h2>

      <h3>Account data</h3>
      <ul>
        <li>your email address;</li>
        <li>a hashed copy of your password (handled and stored by Supabase, our auth provider — we never see your password in plaintext);</li>
        <li>the artist name you choose;</li>
        <li>your avatar image, if you upload one;</li>
        <li>account creation and last-sign-in timestamps.</li>
      </ul>

      <h3>Content you upload</h3>
      <ul>
        <li>audio files (masters, demos, etc.);</li>
        <li>album artwork;</li>
        <li>track titles, version labels, notes, BPM, key, and other metadata;</li>
        <li>any text you type into the app (notes, share invite emails, settings).</li>
      </ul>

      <h3>Usage data</h3>
      <ul>
        <li>plays: which track was played, when, and (if the listener is signed in) by which user;</li>
        <li>saves: which tracks or albums you save from a share link;</li>
        <li>share-link events: creation, visibility changes, revocation;</li>
        <li>for anonymous listeners on share links: the share slug used (not personally identifying).</li>
      </ul>

      <h3>Technical data</h3>
      <ul>
        <li>IP address (used for security and rate-limiting only — not stored long-term);</li>
        <li>browser, operating system, and device type, as automatically reported by your browser;</li>
        <li>error reports (stack traces, the URL that failed, your user ID if signed in) collected by Sentry;</li>
        <li>session cookies used to keep you signed in.</li>
      </ul>

      <h2>2. Why we use it</h2>
      <ul>
        <li><strong>To run the Service.</strong> Store and stream your music, deliver share links, display your library, generate signed URLs.</li>
        <li><strong>To authenticate you.</strong> Email + password verification, password reset links, email confirmations.</li>
        <li><strong>To give you insights.</strong> Show plays and saves for your own tracks.</li>
        <li><strong>To debug.</strong> When something breaks, we look at error logs to figure out what happened.</li>
        <li><strong>To communicate with you.</strong> Transactional emails (signup confirmation, password reset) and occasional product updates (you can opt out of the latter).</li>
        <li><strong>To enforce our Terms.</strong> Detect abuse and respond to legal requests.</li>
      </ul>

      <h2>3. Things we do not do</h2>
      <ul>
        <li>We do <strong>not</strong> sell your data to anyone, ever.</li>
        <li>We do <strong>not</strong> use your music, lyrics, or any other Content to train machine learning or AI models.</li>
        <li>We do <strong>not</strong> share your music with anyone you haven't explicitly invited or shared a link with.</li>
        <li>We do <strong>not</strong> run advertising or third-party tracking pixels.</li>
        <li>We do <strong>not</strong> listen to your Content for any purpose other than operating the Service, investigating a Terms violation (e.g., a DMCA notice), or complying with a valid legal request.</li>
      </ul>

      <h2>4. Sub-processors we use</h2>
      <p>
        Stagehand relies on a small set of third-party vendors ("sub-processors") to run. They each
        only see the data they need:
      </p>
      <ul>
        <li><strong>Supabase</strong> — authentication, database, and file storage. Your account, content, and metadata live here. Hosted in the United States.</li>
        <li><strong>Netlify</strong> — web hosting and edge functions (used for share-link previews). They see HTTP request metadata.</li>
        <li><strong>Sentry</strong> — error monitoring. Receives stack traces and the user ID of whoever hit the error, so we can fix it.</li>
        <li><strong>Resend</strong> — transactional email delivery. Receives your email address and the message being sent (signup confirmation, password reset, etc.).</li>
      </ul>
      <p>
        We choose sub-processors with strong security practices and review their data handling
        before integrating. We'll update this list when it changes.
      </p>

      <h2>5. Sharing and listener access</h2>
      <p>
        When you create a share link, the recipient can play the audio and (if you allowed it)
        download it. Stagehand keeps a record of plays and saves through each share so you can see
        listener engagement in your insights. Listeners who don't sign in are recorded as anonymous
        plays; we don't track them across sessions.
      </p>

      <h2>6. How long we keep your data</h2>
      <ul>
        <li><strong>Account and content:</strong> for as long as your account is active.</li>
        <li><strong>After account deletion:</strong> we delete your content and account data within 30 days. Some data may persist in encrypted backups for up to 30 additional days before backup rotation, then is gone permanently.</li>
        <li><strong>Error logs:</strong> Sentry retention is 90 days for events.</li>
        <li><strong>Legal holds:</strong> if we receive a valid legal request requiring retention, we may keep specific records longer.</li>
      </ul>

      <h2>7. Your rights</h2>
      <p>You can, at any time:</p>
      <ul>
        <li><strong>Access</strong> your data through the app (everything you've uploaded is visible to you in your library).</li>
        <li><strong>Export</strong> your audio files through the per-track Download button (when downloads are enabled on your account, currently always-on).</li>
        <li><strong>Correct</strong> any account information from your Profile page.</li>
        <li><strong>Delete</strong> individual albums, tracks, or your entire account.</li>
        <li><strong>Object</strong> to any processing you disagree with by emailing us.</li>
      </ul>
      <p>
        If you are in the EU, UK, California, or another jurisdiction with similar privacy
        legislation, the rights above apply to you under those laws (GDPR, UK-GDPR, CCPA, etc.).
        Send any such request to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>8. Cookies</h2>
      <p>
        Stagehand uses essential cookies only — they keep you signed in and prevent CSRF attacks.
        We don't use advertising, social-media, or third-party tracking cookies.
      </p>

      <h2>9. Security</h2>
      <p>
        Your audio files are stored in a private bucket and served only via short-lived signed
        URLs. Account passwords are hashed by Supabase using bcrypt; we never see them. Traffic is
        encrypted in transit via TLS. We follow the principle of least access internally —
        Stagehand operators don't browse user content.
      </p>
      <p>
        No system is perfectly secure. If we ever discover a breach affecting your data, we'll
        notify affected users within 72 hours and explain what happened, what we did about it, and
        what you should do.
      </p>

      <h2>10. Children</h2>
      <p>
        Stagehand isn't intended for users under 13. We don't knowingly collect data from anyone
        under 13. If you believe a child has signed up, email us and we'll remove the account.
      </p>

      <h2>11. International users</h2>
      <p>
        Stagehand's servers are located in the United States. If you use the Service from outside
        the U.S., your data will be transferred to and processed in the U.S. By using Stagehand,
        you consent to that transfer.
      </p>

      <h2>12. Changes to this policy</h2>
      <p>
        We may update this Privacy Policy. Material changes will be announced in-app or by email at
        least 14 days before they take effect. The "Effective" date at the top of the page always
        shows the current version.
      </p>

      <h2>13. Contact</h2>
      <p>
        Questions about this policy, requests to access or delete your data, or anything privacy
        related: email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPageShell>
  );
}
