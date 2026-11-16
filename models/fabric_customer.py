import re
from odoo import models, fields, api, _

class FabricCustomer(models.Model):
    _name = 'fabric.customer'
    _inherit = ['fabric.time.limit.mixin', 'mail.thread', 'mail.activity.mixin']
    _description = 'Fabric Customer & Khata Master'
    _order = 'id asc'

    company_id = fields.Many2one('res.company', string='Company', default=lambda self: self.env.company)
    currency_id = fields.Many2one('res.currency', related='company_id.currency_id', string='Currency')
    code = fields.Char(string='Customer ID', default=lambda self: self._get_next_customer_code(), tracking=True)
    name = fields.Char(string='Customer Name & Store', required=True, tracking=True)
    phone = fields.Char(string='Contact Phone', default='N/A', tracking=True)

    store_address = fields.Text(string='Store / Market Address', tracking=True)
    
    transaction_ids = fields.One2many('fabric.khata.transaction', 'customer_id', string='Khata Transactions')
    
    total_sales = fields.Float(compute='_compute_khata_totals', string='Total Cash Out (Udhaar)', store=True, tracking=True)
    paid_amount = fields.Float(compute='_compute_khata_totals', string='Total Cash In (Jama)', store=True, tracking=True)
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
            cust.current_net_balance = jama_total - udhaar_total
            cust.status = 'udhaar_due' if cust.current_net_balance < -0.01 else 'clear'
            
            # Synchronize running balance on each transaction counting from bottom to top
            txs = cust.transaction_ids.sorted(key=lambda t: (t.date or fields.Date.today(), t.id or 0), reverse=True)
            bal = 0.0
            for tx in txs:
                if tx.entry_type == 'jama':
                    bal += (tx.amount or 0.0)
                elif tx.entry_type == 'udhaar':
                    bal -= (tx.amount or 0.0)
                if tx.running_balance != bal:
                    tx.running_balance = bal

            dates = [t.date for t in cust.transaction_ids if t.date]
            if dates:
                m_date = max(dates)
                cust.last_activity_date = m_date.date() if hasattr(m_date, 'date') else m_date
            else:
                cust.last_activity_date = fields.Date.today()

    def _recompute_running_balances(self):
        for cust in self:
            # Recompute from bottom to top (date desc, id desc)
            txs = self.env['fabric.khata.transaction'].search(
                [('customer_id', '=', cust.id)],
                order='date desc, id desc'
            )
            bal = 0.0
            for tx in txs:
                if tx.entry_type == 'jama':
                    bal += (tx.amount or 0.0)
                elif tx.entry_type == 'udhaar':
                    bal -= (tx.amount or 0.0)
                if tx.running_balance != bal:
                    tx.sudo().write({'running_balance': bal})

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

    def unlink(self):
        cust_ids = self.ids
        cust_names = [c.name for c in self if c.name]
        
        # 1. Search and delete all Daily Sale lines linked to these customers
        domain_sale = ['|', ('customer_id', 'in', cust_ids), ('customer_name', 'in', cust_names)] if cust_names else [('customer_id', 'in', cust_ids)]
        sale_lines = self.env['fabric.daily.sale.line'].sudo().search(domain_sale)
        
        # 2. Search and delete all Daily Cash In lines linked to these customers
        domain_cashin = ['|', ('customer_id', 'in', cust_ids), ('customer_name', 'in', cust_names)] if cust_names else [('customer_id', 'in', cust_ids)]
        cashin_lines = self.env['fabric.daily.cashin.line'].sudo().search(domain_cashin)
        
        # 3. Search and delete all Daily Cash Out lines linked to these customers
        domain_cashout = ['|', ('customer_id', 'in', cust_ids), ('customer_name', 'in', cust_names)] if cust_names else [('customer_id', 'in', cust_ids)]
        cashout_lines = self.env['fabric.daily.cashout.line'].sudo().search(domain_cashout)
        
        # Collect affected daily sheets to recompute totals
        affected_sheets = (sale_lines.mapped('sheet_id') | cashin_lines.mapped('sheet_id') | cashout_lines.mapped('sheet_id'))
        
        if sale_lines:
            sale_lines.with_context(bypass_24h_restriction=True).unlink()
        if cashin_lines:
            cashin_lines.with_context(bypass_24h_restriction=True).unlink()
        if cashout_lines:
            cashout_lines.with_context(bypass_24h_restriction=True).unlink()
            
        if affected_sheets:
            affected_sheets._compute_sheet_totals()
            
        # 4. Search and delete any remaining Khata transactions linked to these customers
        khata_txs = self.env['fabric.khata.transaction'].sudo().search([('customer_id', 'in', cust_ids)])
        if khata_txs:
            khata_txs.with_context(bypass_24h_restriction=True).unlink()
            
        # 5. Search and delete visit notes linked to these customers
        visit_notes = self.env['fabric.visit.note'].sudo().search([('customer_id', 'in', cust_ids)])
        if visit_notes:
            visit_notes.with_context(bypass_24h_restriction=True).unlink()
            
        return super().unlink()

    def action_delete_customer(self):
        self.ensure_one()
        self.unlink()
        act_ref = self.env.ref('fabric_erp.action_fabric_customer', raise_if_not_found=False)
        if act_ref:
            action = act_ref.read()[0]
            action['target'] = 'current'
            return action
        return {
            'type': 'ir.actions.act_window',
            'name': 'Customer Khata Accounts Directory',
            'res_model': 'fabric.customer',
            'view_mode': 'list,form',
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
        
        def fmt_amt(val):
            formatted = f"{float(val or 0.0):,.2f}"
            return formatted[:-3] if formatted.endswith('.00') else formatted

        def format_tx_line(tx):
            t_date = tx.date.strftime('%d-%b-%Y') if tx.date else ''
            amt_str = fmt_amt(tx.amount)
            raw_p = (tx.particulars or '').replace('(Draft)', '').replace('(draft)', '').strip()

            if tx.entry_type == 'jama':
                clean = raw_p.replace('Cash In:', '').replace('Cash In', '').strip()
                if not clean or clean.lower() in ('payment received', 'draft', 'none'):
                    label = "Receive"
                else:
                    label = f"Receive - {clean}"
                return f"{t_date} | {label} | +{amt_str}"
            else:
                if 'Unpaid Sale:' in raw_p or 'Item:' in raw_p:
                    parts = [p.strip() for p in raw_p.split('|')]
                    item, rolls, measure, rate, note = '', '', '', '', ''
                    for p in parts:
                        if p.startswith('Item:'):
                            item = p.replace('Item:', '').strip()
                        elif p.startswith('Qty:'):
                            qty_str = p.replace('Qty:', '').strip()
                            m = re.search(r'(\d+)\s*Rolls?\s*/\s*([\d.]+\s*\w+)', qty_str, re.IGNORECASE)
                            if m:
                                rolls = m.group(1).strip()
                                measure = m.group(2).strip()
                            else:
                                measure = qty_str
                        elif p.startswith('Rate:'):
                            rate = p.replace('Rate:', '').strip()
                        elif p.startswith('Note:'):
                            note = p.replace('Note:', '').strip()
                    
                    measure = re.sub(r'Meters\b', 'Meter', measure, flags=re.IGNORECASE)
                    measure = re.sub(r'Yards\b', 'Yard', measure, flags=re.IGNORECASE)

                    line_parts = []
                    if rolls and item:
                        line_parts.append(f"{rolls} {item}")
                    elif item:
                        line_parts.append(item)

                    if measure:
                        line_parts.append(measure)
                    if rate:
                        line_parts.append(rate)
                    if note and note.lower() not in (item.lower(), f"{rolls} roll {item.lower()}"):
                        line_parts.append(note)

                    details = " | ".join(line_parts) if line_parts else (raw_p or "Sale")
                    return f"{t_date} | {details} | -{amt_str}"
                else:
                    clean = raw_p.replace('Cash Out:', '').replace('Cash Out', '').strip()
                    if not clean or clean.lower() in ('payment given', 'draft', 'none'):
                        label = "Udhaar"
                    else:
                        label = clean
                    return f"{t_date} | {label} | -{amt_str}"

        msg = f"Customer - {self.name}\n\n"
        msg += "Transaction History:\n"

        if txs:
            if len(txs) > 50:
                txs = txs[-50:]
            for i, tx in enumerate(txs):
                msg += f"{i+1}. {format_tx_line(tx)}\n"
        else:
            msg += "No transactions found.\n"

        net_val = fmt_amt(self.current_net_balance)
        msg += f"\nNet Balance : {net_val}\n"

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
