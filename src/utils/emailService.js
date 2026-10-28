/**
 * Third-Party Email Invitation Service
 * Supports triggering hosted email templates via 3rd party REST APIs
 * (SendGrid, Resend, Postmark, or custom Webhook).
 */

export const sendUserInviteEmail = async ({
  email,
  name,
  roleName,
  clubName,
  teamNames = [],
  tempPassword = null
}) => {
  const provider = (import.meta.env.VITE_EMAIL_PROVIDER || '').toLowerCase();
  const apiKey = import.meta.env.VITE_EMAIL_API_KEY;
  const templateId = import.meta.env.VITE_EMAIL_TEMPLATE_ID;
  const fromEmail = import.meta.env.VITE_EMAIL_FROM || 'noreply@youthfootballtracker.com';
  const loginUrl = window.location.origin;

  if (!apiKey) {
    return {
      success: false,
      notConfigured: true,
      message: 'No email API key configured. You can copy the credentials/invite link manually.'
    };
  }

  const templateData = {
    coach_name: name || email.split('@')[0],
    recipient_email: email,
    club_name: clubName || 'Your Club',
    assigned_teams: teamNames.length > 0 ? teamNames.join(', ') : 'Assigned squad',
    role_label: roleName || 'Normal User',
    temp_password: tempPassword || 'Set on first login',
    login_url: loginUrl
  };

  try {
    if (provider === 'sendgrid') {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: { email: fromEmail, name: 'Youth Football Manager' },
          personalizations: [
            {
              to: [{ email }],
              dynamic_template_data: templateData
            }
          ],
          template_id: templateId
        })
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`SendGrid API error (${res.status}): ${errorText}`);
      }
      return { success: true, message: `Invitation email sent via SendGrid to ${email}` };
    }

    if (provider === 'resend') {
      const payload = {
        from: fromEmail,
        to: [email],
        subject: `You've been invited to ${templateData.club_name} on Youth Football Manager`
      };

      if (templateId) {
        payload.template_id = templateId;
        payload.data = templateData;
      } else {
        payload.html = `
          <div style="font-family: sans-serif; max-width: 540px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <h2 style="color: #1e293b; margin-top: 0;">Welcome to ${templateData.club_name}</h2>
            <p>Hi ${templateData.coach_name},</p>
            <p>You have been invited to manage match stats and squads for <strong>${templateData.club_name}</strong> as a <strong>${templateData.role_label}</strong>.</p>
            <div style="background-color: #f8fafc; border-radius: 6px; padding: 12px 16px; margin: 16px 0;">
              <p style="margin: 4px 0;"><strong>Assigned Teams:</strong> ${templateData.assigned_teams}</p>
              ${tempPassword ? `<p style="margin: 4px 0;"><strong>Temporary Password:</strong> <code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">${tempPassword}</code></p>` : ''}
            </div>
            <p style="margin-top: 24px;">
              <a href="${templateData.login_url}" style="background-color: #0284c7; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">Log In to Team Tracker</a>
            </p>
          </div>
        `;
      }

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Resend API error (${res.status}): ${errorText}`);
      }
      return { success: true, message: `Invitation email sent via Resend to ${email}` };
    }

    // Generic webhook trigger
    if (provider === 'webhook' || provider === 'custom') {
      const endpoint = import.meta.env.VITE_EMAIL_ENDPOINT;
      if (!endpoint) throw new Error('VITE_EMAIL_ENDPOINT is required for custom email webhook');

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          recipient: email,
          template_id: templateId,
          data: templateData
        })
      });

      if (!res.ok) {
        throw new Error(`Email Webhook error (${res.status})`);
      }
      return { success: true, message: `Invitation email dispatched to ${email}` };
    }

    return {
      success: false,
      notConfigured: true,
      message: `Unknown email provider: "${provider}". You can copy the credentials/invite link manually.`
    };
  } catch (error) {
    console.error('sendUserInviteEmail error:', error);
    return { success: false, error: error.message };
  }
};
