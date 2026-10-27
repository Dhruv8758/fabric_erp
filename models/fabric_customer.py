from odoo import models, fields, api, _

class FabricCustomer(models.Model):
    _name = 'fabric.customer'
    _inherit = ['fabric.time.limit.mixin', 'mail.thread', 'mail.activity.mixin']
    _description = 'Fabric Customer & Khata Master'
    _order = 'name asc'

    company_id = fields.Many2one('res.company', string='Company', default=lambda self: self.env.company)
    currency_id = fields.Many2one('res.currency', related='company_id.currency_id', string='Currency')
    code = fields.Char(string='Customer ID', default=lambda self: self._get_next_customer_code(), tracking=True)
    name = fields.Char(string='Customer Name & Store', required=True, tracking=True)
    phone = fields.Char(string='Contact Phone', default='N/A', tracking=True)

    store_address = fields.Text(string='Store / Market Address', tracking=True)
    
    transaction_ids = fields.One2many('fabric.khata.transaction', 'customer_id', string='Khata Transactions')
    
    total_sales = fields.Float(compute='_compute_khata_totals', string='Total Sales', store=True, tracking=True)
    paid_amount = fields.Float(compute='_compute_khata_totals', string='Paid Amount', store=True, tracking=True)
    current_net_balance = fields.Float(compute='_compute_khata_totals', string='Current Net Balance', store=True, tracking=True)
    
    status = fields.Selection([
        ('clear', 'Clear'),
        ('udhaar_due', 'Udhaar Due')
    ], compute='_compute_khata_totals', string='Status', store=True, tracking=True)
    
    last_activity_date = fields.Date(compute='_compute_khata_totals', string='Last Activity Date', store=True)

    @api.model
    def _get_next_customer_code(self):
        existing_codes = self.search_read([('code', '!=', False)], ['code'])
        nums = []
        for c in existing_codes:
            code_str = str(c.get('code') or '').strip()
            if code_str.isdigit():
                nums.append(int(code_str))
        if nums:
            return str(max(nums) + 1)
        return '1'

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if not vals.get('code') or vals.get('code') in ('CUST-NEW', 'New', ''):
                vals['code'] = self._get_next_customer_code()
        return super().create(vals_list)

    @api.depends('transaction_ids.amount', 'transaction_ids.entry_type', 'transaction_ids.date')
    def _compute_khata_totals(self):
        for cust in self:
            udhaar_total = sum(t.amount for t in cust.transaction_ids if t.entry_type == 'udhaar')
            jama_total = sum(t.amount for t in cust.transaction_ids if t.entry_type == 'jama')
            
            cust.total_sales = udhaar_total
            cust.paid_amount = jama_total
            cust.current_net_balance = udhaar_total - jama_total
            cust.status = 'udhaar_due' if cust.current_net_balance > 0.01 else 'clear'
            
            dates = [t.date for t in cust.transaction_ids if t.date]
            cust.last_activity_date = max(dates).date() if dates else fields.Date.today()

    def action_view_ledger(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': f'Khata Ledger - {self.name}',
            'res_model': 'fabric.customer',
            'res_id': self.id,
            'view_mode': 'form',
            'target': 'current',
        }

    def action_give_udhaar_dialog(self):
        self.ensure_one()
        return {
            'name': _('Give Udhaar (Debit Sale)'),
            'type': 'ir.actions.act_window',
            'res_model': 'fabric.khata.transaction.wizard',
            'view_mode': 'form',
            'target': 'new',
            'context': {
                'default_customer_id': self.id,
                'default_entry_type': 'udhaar',
            }
        }

    def action_record_jama_dialog(self):
        self.ensure_one()
        return {
            'name': _('Record Jama Payment (Credit)'),
            'type': 'ir.actions.act_window',
            'res_model': 'fabric.khata.transaction.wizard',
            'view_mode': 'form',
            'target': 'new',
            'context': {
                'default_customer_id': self.id,
                'default_entry_type': 'jama',
            }
        }

    def action_back_to_dashboard(self):
        return {
            'type': 'ir.actions.client',
            'tag': 'fabric_erp.dashboard',
        }

    def action_share_whatsapp(self):
        self.ensure_one()
        # Fetch transactions in chronological order: first entry first, last created last
        txs = self.env['fabric.khata.transaction'].search(
            [('customer_id', '=', self.id)],
            order='date asc, id asc'
        )
        
        msg = f"*Khata Summary for {self.name}*\n"
        msg += f"*Current Net Balance:* {self.current_net_balance:.2f}\n\n"
        
        if txs:
            if len(txs) > 50:
                txs = txs[-50:]
                msg += f"*Recent Transactions (Last {len(txs)}):*\n"
            else:
                msg += "*Transaction History:*\n"

            for i, tx in enumerate(txs):
                t_date = tx.date.strftime('%d-%b-%Y') if tx.date else ''
                t_type = 'Udhaar' if tx.entry_type == 'udhaar' else 'Jama'
                particulars = tx.particulars or ''
                msg += f"{i+1}. {t_date} | {t_type} | {tx.amount:.2f} | {particulars}\n"
        else:
            msg += "No transactions found.\n"
            
        import urllib.parse
        encoded_msg = urllib.parse.quote(msg.strip())
        
        phone = self.phone or ''
        phone = phone.replace('+', '').replace(' ', '').replace('-', '')
        url = f"https://wa.me/{phone}?text={encoded_msg}" if (phone and phone != 'N/A') else f"https://wa.me/?text={encoded_msg}"

        return {
            'type': 'ir.actions.act_url',
            'url': url,
            'target': 'new',
        }
