import LegalPageShell from "../components/LegalPageShell";

const CONTACT_EMAIL = "stagehand.studio@gmail.com";

export default function TermsPage() {
  return (
    <LegalPageShell title="Terms of Service" effectiveDate="May 17, 2026">
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 mb-8 text-xs text-amber-200/90">
        <strong className="text-amber-200">Beta notice.</strong> Stagehand is currently in
        invite-only beta. The service is provided as-is while we iterate; expect occasional bugs,
        downtime, and rare interruptions. We back up your data daily, but you should keep your own
        copies of your audio files.
      </div>

      <p>
        These Terms of Service ("Terms") govern your access to and use of Stagehand (the
        "Service"), an album studio and private listening tool for working artists, operated by the
        Stagehand team ("we", "us"). By creating an account or using the Service, you agree to
        these Terms.
      </p>

      <h2>1. Eligibility</h2>
      <p>
        You must be at least 18 years old, or the age of majority in your jurisdiction, to use
        Stagehand. By using the Service, you represent that you have the legal capacity to enter
        into these Terms. You are responsible for any activity that happens on your account.
      </p>

      <h2>2. Your account</h2>
      <p>
        You are responsible for keeping your password secure and for everything that happens under
        your account. Tell us immediately at{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> if you believe your account has been
        compromised. You can delete your account at any time; we'll remove your content within 30
        days, except where retention is required by law.
      </p>

      <h2>3. Your content stays yours</h2>
      <p>
        <strong>
          You retain all ownership and intellectual property rights in any audio, artwork, lyrics,
          notes, or other content you upload to Stagehand (your "Content").
        </strong>{" "}
        Nothing in these Terms transfers any of those rights to us.
      </p>
      <p>
        To operate the Service for you, you grant us a limited, worldwide, royalty-free,
        non-exclusive license to host, store, transmit, transcode (e.g., generate waveform
        previews), and stream your Content solely to:
      </p>
      <ul>
        <li>provide the Service to you;</li>
        <li>deliver the Content to people you explicitly share it with via a Stagehand share link;</li>
        <li>create backups, security copies, and operational logs.</li>
      </ul>
      <p>
        This license ends when you delete the Content or your account, except for backups already
        in flight, which are deleted on our standard backup-rotation schedule (currently 30 days).
      </p>
      <p>
        <strong>We do not:</strong>
      </p>
      <ul>
        <li>claim ownership of your music or any other Content;</li>
        <li>use your Content to train AI or machine learning models;</li>
        <li>license your Content to third parties;</li>
        <li>advertise on the Service or sell your data;</li>
        <li>access your Content for any purpose other than operating the Service, responding to a legal request, or investigating a Terms violation (e.g., a DMCA notice).</li>
      </ul>

      <h2>4. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>upload Content you don't have the rights to;</li>
        <li>use the Service to distribute malware, phishing, or illegal content;</li>
        <li>circumvent any access control or rate limit;</li>
        <li>scrape, mirror, or systematically download other users' Content;</li>
        <li>impersonate another person or misrepresent your affiliation with an artist or label;</li>
        <li>resell, sublicense, or commercially exploit the Service without our written permission.</li>
      </ul>
      <p>
        We may suspend or terminate accounts that violate these rules, with or without notice
        depending on severity.
      </p>

      <h2>5. Sharing and listener access</h2>
      <p>
        Stagehand lets you generate share links with different visibility settings (anyone with the
        link, invite-only, or private). You are responsible for the share links you create and for
        the people you give them to. We do our best to honor your settings (single-use,
        invite-only, expiration) but the Service is not a substitute for an NDA — anything you
        share can be re-recorded or screen-captured by the recipient.
      </p>

      <h2>6. DMCA and copyright</h2>
      <p>
        We respect intellectual property rights. If you believe Content on Stagehand infringes your
        copyright, send a notice to{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with:
      </p>
      <ul>
        <li>your physical or electronic signature;</li>
        <li>identification of the copyrighted work claimed to be infringed;</li>
        <li>identification of the material you believe is infringing (e.g., a Stagehand share link);</li>
        <li>your contact information (address, phone, email);</li>
        <li>a statement that you have a good-faith belief that the use is not authorized by the rights holder, agent, or law;</li>
        <li>a statement, under penalty of perjury, that the information in your notice is accurate and that you are the rights holder or authorized to act on their behalf.</li>
      </ul>
      <p>
        We will remove the material or disable access as required, and notify the affected user.
        Repeat infringers will have their accounts terminated.
      </p>

      <h2>7. Beta service; no warranty</h2>
      <p>
        The Service is provided <strong>"as is" and "as available"</strong>, without warranty of
        any kind, express or implied, including merchantability, fitness for a particular purpose,
        or non-infringement. We do not warrant that the Service will be uninterrupted, secure, or
        error-free, or that any data loss or corruption will not occur. You are responsible for
        keeping your own copies of any Content you can't afford to lose.
      </p>

      <h2>8. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, in no event will Stagehand or its operators be
        liable for any indirect, incidental, special, consequential, or punitive damages, including
        but not limited to loss of profits, revenue, data, goodwill, or other intangible losses,
        arising out of or in connection with your use of the Service. Our total liability for any
        claim arising out of or relating to these Terms or the Service will not exceed the amount
        you paid us in the twelve (12) months immediately before the claim arose, or USD $50,
        whichever is greater.
      </p>

      <h2>9. Indemnification</h2>
      <p>
        You agree to indemnify and hold harmless Stagehand and its operators from any claim,
        liability, or expense (including reasonable attorneys' fees) arising out of your Content,
        your use of the Service, or your breach of these Terms.
      </p>

      <h2>10. Termination</h2>
      <p>
        You can stop using the Service and delete your account at any time. We can suspend or
        terminate your access at any time, with or without notice, if we believe you've violated
        these Terms or if continued provision of the Service to you is no longer commercially
        reasonable. Sections 3, 7, 8, 9, and 12 survive termination.
      </p>

      <h2>11. Changes to the Service or these Terms</h2>
      <p>
        We may modify, suspend, or discontinue any part of the Service at any time. We may also
        update these Terms; material changes will be announced in-app or by email at least 14 days
        before they take effect. Continuing to use the Service after the effective date means you
        accept the updated Terms.
      </p>

      <h2>12. Governing law</h2>
      <p>
        These Terms are governed by the laws of the jurisdiction in which the Stagehand team is
        based, without regard to its conflict-of-laws principles. Any dispute that can't be
        resolved informally will be brought exclusively in the state or federal courts located in
        that jurisdiction.
      </p>

      <h2>13. Contact</h2>
      <p>
        Questions about these Terms? Email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPageShell>
  );
}
