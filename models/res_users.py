from odoo import models, api, _
from odoo.exceptions import UserError

class ResUsers(models.Model):
    _inherit = 'res.users'

    @api.model_create_multi
    def create(self, vals_list):
        current_user = self.env.user
        try:
            from odoo.http import request
            if request and hasattr(request, 'env') and request.env and request.env.user:
                current_user = request.env.user
        except Exception:
            pass

        # Allow system admins or fabric admins; block standard users from creating user accounts directly
        if not current_user._is_superuser() and not current_user.has_group('base.group_system') and not current_user.has_group('fabric_erp.group_fabric_admin'):
            raise UserError(_("Security Restriction: You do not have permission to create user accounts directly. Please contact an Administrator."))
        return super().create(vals_list)
