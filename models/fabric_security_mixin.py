from odoo import models, fields, api, _
from odoo.exceptions import UserError

class FabricTimeLimitMixin(models.AbstractModel):
    _name = 'fabric.time.limit.mixin'
    _description = '24-Hour Edit and Delete Security Mixin'

    def _get_effective_user(self):
        """Returns the actual logged-in user even if model call is wrapped in sudo()"""
        try:
            from odoo.http import request
            if request and hasattr(request, 'env') and request.env and request.env.user:
                return request.env.user
        except Exception:
            pass
        return self.env.user

    def _check_24h_restriction(self, action_name='modify'):
        """Check if record is older than 24 hours (86400s). Regular users are restricted."""
        user = self._get_effective_user()
        # Superusers, Admins and Managers are allowed to edit/delete anytime
        if user._is_superuser() or user.has_group('fabric_erp.group_fabric_manager') or user.has_group('base.group_system'):
            return

        now = fields.Datetime.now()
        for record in self:
            parent_dt = False
            if hasattr(record, 'sheet_id') and record.sheet_id:
                parent_dt = getattr(record.sheet_id, 'create_date', False) or getattr(record.sheet_id, 'date', False)

            rec_dt = getattr(record, 'create_date', False) or getattr(record, 'date', False) or parent_dt

            if rec_dt:
                if isinstance(rec_dt, fields.Date) and not isinstance(rec_dt, fields.Datetime):
                    rec_dt = fields.Datetime.to_datetime(rec_dt)
                if (now - rec_dt).total_seconds() > 86400:
                    raise UserError(_("Security Restriction: You cannot %s records or entries created more than 24 hours ago. Only Managers and Admins can modify entries after 24 hours.") % action_name)

    def write(self, vals):
        self._check_24h_restriction(action_name='edit or update')
        return super().write(vals)

    def unlink(self):
        self._check_24h_restriction(action_name='delete')
        return super().unlink()
