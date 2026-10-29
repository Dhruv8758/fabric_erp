# pyrefly: ignore [missing-import]
from odoo import http, fields
# pyrefly: ignore [missing-import]
from odoo.http import request
from datetime import datetime, timedelta
import calendar
from collections import defaultdict
import base64
import os

class FabricErpController(http.Controller):

    @http.route('/fabric_erp/set_favicon', type='http', auth='public')
    def set_favicon(self):
        path = '/Users/dhruvbhuva/sevencore erp/custom_addons/fabric_erp/static/description/icon.png'
        if os.path.exists(path):
            with open(path, 'rb') as f:
                data = base64.b64encode(f.read())
            request.env['res.company'].sudo().search([]).write({'favicon': data})
            return "Favicon successfully applied to database! You can now close this tab, refresh your ERP, and the icon will appear."
        return "Icon file not found."

    @http.route('/fabric_erp/dashboard_data', type='json', auth='user')
    def get_dashboard_data(self, filter_type='today', date_val=None, month_val=None, year_val=None, **kw):
        today = fields.Date.today()
        if not date_val:
            date_val = str(today)

        sheets_all = request.env['fabric.daily.sheet'].sudo().search([], order='date desc, id desc')
        
        years_set = set()
        months_dict = {}
        for s in sheets_all:
            if s.date:
                years_set.add(s.date.year)
                m_code = s.date.strftime('%Y-%m')
                m_name = s.date.strftime('%B %Y')
                months_dict[m_code] = m_name

        if not years_set:
            years_set.add(today.year)
        if not months_dict:
            months_dict[today.strftime('%Y-%m')] = today.strftime('%B %Y')

        available_years = sorted(list(years_set), reverse=True)
        available_months = [{'code': k, 'name': v} for k, v in sorted(months_dict.items(), reverse=True)]

        domain = []
        period_label = "TODAY"
        period_title = f"Today ({today.strftime('%d/%m/%Y')})"

        if filter_type == 'today':
            today_sheets = request.env['fabric.daily.sheet'].sudo().search([('date', '=', today)], order='date desc, id desc')
            if today_sheets:
                filtered_sheets = today_sheets
                period_label = "TODAY"
                period_title = f"Today ({today.strftime('%d/%m/%Y')})"
            else:
                filtered_sheets = sheets_all[:1] if sheets_all else request.env['fabric.daily.sheet'].sudo()
                if filtered_sheets and filtered_sheets[0].date:
                    s_dt = filtered_sheets[0].date
                    period_label = f"LATEST ({s_dt.strftime('%d %b').upper()})"
                    period_title = f"Latest Sheet ({s_dt.strftime('%d/%m/%Y')})"
                else:
                    period_label = "TODAY"
                    period_title = f"Today ({today.strftime('%d/%m/%Y')})"

        elif filter_type == 'date':
            try:
                target_dt = datetime.strptime(str(date_val), '%Y-%m-%d').date()
                domain = [('date', '=', target_dt)]
                filtered_sheets = request.env['fabric.daily.sheet'].sudo().search(domain, order='date desc, id desc')
                period_label = target_dt.strftime('%d %b %Y').upper()
                period_title = f"Date: {target_dt.strftime('%d/%m/%Y')}"
            except Exception:
                filtered_sheets = sheets_all
                period_label = "ALL TIME"
                period_title = "All Time"

        elif filter_type == 'month':
            if not month_val or month_val in ('null', 'undefined'):
                month_val = available_months[0]['code'] if available_months else today.strftime('%Y-%m')
            
            try:
                if '-' in str(month_val):
                    parts = str(month_val).split('-')
                    y, m = int(parts[0]), int(parts[1])
                else:
                    dt_obj = datetime.strptime(str(month_val), '%B %Y')
                    y, m = dt_obj.year, dt_obj.month
                
                _, last_day = calendar.monthrange(y, m)
                start_d = datetime(y, m, 1).date()
                end_d = datetime(y, m, last_day).date()
                domain = [('date', '>=', start_d), ('date', '<=', end_d)]
                filtered_sheets = request.env['fabric.daily.sheet'].sudo().search(domain, order='date desc, id desc')
                
                dt_disp = datetime(y, m, 1)
                period_label = dt_disp.strftime('%B %Y').upper()
                period_title = f"Month: {dt_disp.strftime('%B %Y')}"
            except Exception:
                filtered_sheets = sheets_all
                period_label = "ALL TIME"
                period_title = "All Time"

        elif filter_type == 'year':
            try:
                y = int(year_val or available_years[0] or today.year)
                start_d = datetime(y, 1, 1).date()
                end_d = datetime(y, 12, 31).date()
                domain = [('date', '>=', start_d), ('date', '<=', end_d)]
                filtered_sheets = request.env['fabric.daily.sheet'].sudo().search(domain, order='date desc, id desc')
                period_label = f"YEAR {y}"
                period_title = f"Year: {y}"
            except Exception:
                filtered_sheets = sheets_all
                period_label = "ALL TIME"
                period_title = "All Time"

        elif filter_type == 'all':
            filtered_sheets = sheets_all
            period_label = "ALL TIME"
            period_title = "All Time Records"
        else:
            filtered_sheets = sheets_all
            period_label = "ALL TIME"
            period_title = "All Time Records"

        sales_total = sum(s.total_sale for s in filtered_sheets)
        bills_count = sum(len(s.sale_line_ids) for s in filtered_sheets)
        shop_expense = sum(s.total_shopexp for s in filtered_sheets)
        home_expense = sum(s.total_homeexp for s in filtered_sheets)

        # Realtime Customer Udhaar Due
        customers = request.env['fabric.customer'].sudo().search([])
        udhaar_due = sum(c.current_net_balance for c in customers) if customers else 0.0

        # Filtered Sales entries
        recent_sales = []
        target_sheets_sales = filtered_sheets
        for s in target_sheets_sales:
            for line in s.sale_line_ids:
                c_name = line.customer_name or line.item_name or 'Cash Customer'
                recent_sales.append({
                    'bill_no': f"DS-{line.id + 10000}-1",
                    'customer': c_name,
                    'item': line.item_name or '',
                    'roll_qty': line.roll_qty,
                    'qty': line.qty,
                    'date': str(s.date),
                    'total': line.total_price,
                    'paid': line.total_price,
                    'mode': 'Cash'
                })
                if len(recent_sales) >= 15:
                    break
            if len(recent_sales) >= 15:
                break

        # Filtered Expense entries
        recent_expenses = []
        target_sheets_exp = filtered_sheets
        for s in target_sheets_exp:
            for line in s.shopexp_line_ids:
                recent_expenses.append({
                    'category': 'Shop Expense',
                    'name': line.note or 'Shop Expense',
                    'note': 'Cash / Operating',
                    'date': str(s.date),
                    'amount': line.money
                })
                if len(recent_expenses) >= 15:
                    break
            for line in s.homeexp_line_ids:
                recent_expenses.append({
                    'category': 'Home Expense',
                    'name': line.note or 'Home Expense',
                    'note': 'Personal Expense',
                    'date': str(s.date),
                    'amount': line.money
                })
                if len(recent_expenses) >= 15:
                    break
            if len(recent_expenses) >= 15:
                break

        # Filtered Month-wise Expense Aggregation
        monthly_map = defaultdict(lambda: {'shop_expense': 0.0, 'home_expense': 0.0, 'count': 0})
        target_sheets_monthly = filtered_sheets
        for s in target_sheets_monthly:
            if s.date:
                m_key = s.date.strftime('%B %Y')
                monthly_map[m_key]['shop_expense'] += s.total_shopexp
                monthly_map[m_key]['home_expense'] += s.total_homeexp
                monthly_map[m_key]['count'] += (len(s.shopexp_line_ids) + len(s.homeexp_line_ids))
        
        # Ensure at least one row shows up for the ledger if completely empty
        if not monthly_map:
            if filter_type == 'month' and month_val and month_val not in ('null', 'undefined'):
                try:
                    if '-' in str(month_val):
                        parts = str(month_val).split('-')
                        dt_disp = datetime(int(parts[0]), int(parts[1]), 1)
                    else:
                        dt_disp = datetime.strptime(str(month_val), '%B %Y')
                    monthly_map[dt_disp.strftime('%B %Y')] = {'shop_expense': 0.0, 'home_expense': 0.0, 'count': 0}
                except:
                    monthly_map[today.strftime('%B %Y')] = {'shop_expense': 0.0, 'home_expense': 0.0, 'count': 0}
            elif filter_type == 'date' and date_val:
                try:
                    dt_disp = datetime.strptime(str(date_val), '%Y-%m-%d')
                    monthly_map[dt_disp.strftime('%B %Y')] = {'shop_expense': 0.0, 'home_expense': 0.0, 'count': 0}
                except:
                    monthly_map[today.strftime('%B %Y')] = {'shop_expense': 0.0, 'home_expense': 0.0, 'count': 0}
            else:
                monthly_map[today.strftime('%B %Y')] = {'shop_expense': 0.0, 'home_expense': 0.0, 'count': 0}

        monthly_expenses = []
        for m_key, vals in monthly_map.items():
            shop_exp = vals['shop_expense']
            home_exp = vals['home_expense']
            monthly_expenses.append({
                'month': m_key,
                'shop_expense': shop_exp,
                'home_expense': home_exp,
                'total': shop_exp + home_exp,
                'count': vals['count']
            })

        return {
            'date': str(today),
            'filter_type': filter_type,
            'period_label': period_label,
            'period_title': period_title,
            'todays_sales': sales_total,
            'bills_count': bills_count,
            'udhaar_due': udhaar_due,
            'shop_expense': shop_expense,
            'home_expense': home_expense,
            'recent_sales': recent_sales,
            'recent_expenses': recent_expenses,
            'monthly_expenses': monthly_expenses,
            'available_years': available_years,
            'available_months': available_months,
        }



    @http.route('/fabric_erp/get_customers', type='json', auth='user')
    def get_customers(self):
        customers = request.env['fabric.customer'].sudo().search_read([], ['id', 'name', 'phone', 'current_net_balance'])
        return customers

    @http.route('/fabric_erp/create_customer', type='json', auth='user')
    def create_customer(self, name):
        if not name or not name.strip():
            return {'status': 'error', 'message': 'Invalid name'}
        name = name.strip()
        cust = request.env['fabric.customer'].sudo().search([('name', '=ilike', name)], limit=1)
        if not cust:
            cust = request.env['fabric.customer'].sudo().create({'name': name})
        return {'status': 'success', 'id': cust.id, 'name': cust.name}

    @http.route('/fabric_erp/get_products', type='json', auth='user')
    def get_products(self):
        products = request.env['fabric.product'].sudo().search_read([], ['id', 'name', 'code', 'unit', 'price_per_unit', 'quantity'])
        return products

    @http.route('/fabric_erp/get_units', type='json', auth='user')
    def get_units(self):
        units = request.env['fabric.unit'].sudo().search_read([('active', '=', True)], ['id', 'name', 'code'], order='sequence asc, name asc')
        if not units:
            defaults = [
                {'name': 'Meter', 'code': 'M', 'sequence': 1},
                {'name': 'Yard', 'code': 'YD', 'sequence': 2},
                {'name': 'Roll', 'code': 'ROLL', 'sequence': 3},
                {'name': 'Piece', 'code': 'PC', 'sequence': 4},
                {'name': 'Kg', 'code': 'KG', 'sequence': 5},
            ]
            for d in defaults:
                request.env['fabric.unit'].sudo().create(d)
            units = request.env['fabric.unit'].sudo().search_read([('active', '=', True)], ['id', 'name', 'code'], order='sequence asc, name asc')
        return units

    @http.route('/fabric_erp/create_product', type='json', auth='user')
    def create_product(self, name, unit='Meter', price=0.0):
        if not name or not name.strip():
            return {'status': 'error', 'message': 'Invalid name'}
        name = name.strip()
        prod = request.env['fabric.product'].sudo().search([('name', '=ilike', name)], limit=1)
        if not prod:
            unit_rec = request.env['fabric.unit'].sudo().search([('name', '=ilike', unit)], limit=1)
            prod = request.env['fabric.product'].sudo().create({
                'name': name,
                'unit': unit,
                'unit_id': unit_rec.id if unit_rec else False,
                'price_per_unit': price
            })
        return {'status': 'success', 'id': prod.id, 'name': prod.name, 'unit': prod.unit, 'price_per_unit': prod.price_per_unit}



    @http.route('/fabric_erp/get_daily_sheet_by_date', type='json', auth='user')
    def get_daily_sheet_by_date(self, date_str):
        sheet = request.env['fabric.daily.sheet'].sudo().search([('date', '=', date_str)], limit=1)
        
        try:
            current_date = datetime.strptime(date_str, '%Y-%m-%d')
            prev_date_str = (current_date - timedelta(days=1)).strftime('%Y-%m-%d')
            prev_sheet = request.env['fabric.daily.sheet'].sudo().search([('date', '=', prev_date_str)], limit=1)
        except Exception:
            prev_sheet = False
        
        prev_day_balance = 0.0
        if prev_sheet:
            prev_day_balance = prev_sheet.current_day_balance or prev_sheet.total_sale

        if not sheet:
            last_balance = prev_day_balance if prev_day_balance else 0.0
            return {
                'exists': False,
                'last_balance': last_balance,
                'saleLines': [],
                'cashinLines': [],
                'cashoutLines': [],
                'shopexpLines': [],
                'homeexpLines': []
            }

        sheet_last_bal = sheet.last_balance if sheet.last_balance else prev_day_balance

        create_user = sheet.create_uid.name if sheet and sheet.create_uid else ''
        create_time = fields.Datetime.context_timestamp(request.env.user, sheet.create_date).strftime('%d/%m/%Y %I:%M %p') if (sheet and sheet.create_date) else ''
        write_user = sheet.write_uid.name if sheet and sheet.write_uid else ''
        write_time = fields.Datetime.context_timestamp(request.env.user, sheet.write_date).strftime('%d/%m/%Y %I:%M %p') if (sheet and sheet.write_date) else ''

        history_logs = []
        if sheet:
            msgs = request.env['mail.message'].sudo().search([
                ('model', '=', 'fabric.daily.sheet'),
                ('res_id', '=', sheet.id)
            ], order='id desc', limit=15)
            for m in msgs:
                author_name = m.author_id.name or m.create_uid.name or 'System'
                msg_time = fields.Datetime.context_timestamp(request.env.user, m.date).strftime('%d/%m/%Y %I:%M %p') if m.date else ''
                history_logs.append({
                    'id': m.id,
                    'author': author_name,
                    'time': msg_time,
                    'body': m.body or ''
                })

        return {
            'exists': True,
            'sheet_id': sheet.id,
            'current_uid': request.env.user.id,
            'last_balance': sheet_last_bal,
            'create_user': create_user,
            'create_time': create_time,
            'write_user': write_user,
            'write_time': write_time,
            'history_logs': history_logs,

            'saleLines': [{
                'id': l.id,
                'customer_name': l.customer_name or '',
                'roll_qty': l.roll_qty,
                'qty': l.qty,
                'item_name': l.item_name,
                'unit': l.unit,
                'price': l.price_per_unit,
                'total': l.total_price,
                'note': l.note or '',
                'roll_meters_str': l.roll_meters_str or '',
                'is_unpaid': l.is_unpaid or False,
                'create_uid': l.create_uid.id if l.create_uid else False,
                'create_uid_name': l.create_uid.name if l.create_uid else 'System'
            } for l in sheet.sale_line_ids],
            'cashinLines': [{
                'id': l.id,
                'customer_name': l.customer_name or '',
                'note': l.note,
                'money': l.money,
                'is_khata': l.is_khata or False,
                'create_uid': l.create_uid.id if l.create_uid else False,
                'create_uid_name': l.create_uid.name if l.create_uid else 'System'
            } for l in sheet.cashin_line_ids],
            'cashoutLines': [{
                'id': l.id,
                'customer_name': l.customer_name or '',
                'note': l.note,
                'money': l.money,
                'is_khata': l.is_khata or False,
                'create_uid': l.create_uid.id if l.create_uid else False,
                'create_uid_name': l.create_uid.name if l.create_uid else 'System'
            } for l in sheet.cashout_line_ids],
            'shopexpLines': [{
                'id': l.id,
                'note': l.note,
                'money': l.money,
                'create_uid': l.create_uid.id if l.create_uid else False,
                'create_uid_name': l.create_uid.name if l.create_uid else 'System'
            } for l in sheet.shopexp_line_ids],
            'homeexpLines': [{
                'id': l.id,
                'note': l.note,
                'money': l.money,
                'create_uid': l.create_uid.id if l.create_uid else False,
                'create_uid_name': l.create_uid.name if l.create_uid else 'System'
            } for l in sheet.homeexp_line_ids],
        }

    @http.route('/fabric_erp/save_daily_sheet', type='json', auth='user')
    def save_daily_sheet(self, date_str, last_balance, sale_lines, cashin_lines, cashout_lines, shopexp_lines, homeexp_lines, is_silent=False):
        def safe_float(val):
            if not val:
                return 0.0
            try:
                if isinstance(val, str) and not val.strip():
                    return 0.0
                return float(val)
            except ValueError:
                return 0.0

        sheet_model = request.env['fabric.daily.sheet'].sudo()
        cust_model = request.env['fabric.customer'].sudo()
        
        sheet = sheet_model.search([('date', '=', date_str)], limit=1)

        existing_sale_ids = sheet.sale_line_ids.ids if sheet else []
        processed_sale_lines = []
        for l in sale_lines:
            c_name = (l.get('customer_name') or '').strip()
            i_name = (l.get('item_name') or '').strip()
            roll_qty = safe_float(l.get('roll_qty'))
            qty = safe_float(l.get('qty'))
            unit = l.get('unit') or 'Meter'
            price = safe_float(l.get('price'))
            total = safe_float(l.get('total'))
            note = (l.get('note') or '').strip()
            roll_str = (l.get('roll_meters_str') or '').strip()
            is_unpaid = bool(l.get('is_unpaid'))

            if not c_name and not i_name and roll_qty == 0 and qty == 0 and total == 0 and price == 0 and not note and not roll_str:
                continue

            cust_rec = False
            if c_name:
                cust_rec = cust_model.search([('name', '=ilike', c_name)], limit=1)
                if not cust_rec and not is_silent:
                    cust_rec = cust_model.create({'name': c_name})
                    
            prod_rec = False
            if i_name:
                prod_rec = request.env['fabric.product'].sudo().search([('name', '=ilike', i_name)], limit=1)
                if not prod_rec and not is_silent:
                    prod_rec = request.env['fabric.product'].sudo().create({'name': i_name, 'unit': unit, 'price_per_unit': price})

            vals = {
                'customer_id': cust_rec.id if cust_rec else False,
                'customer_name': c_name,
                'product_id': prod_rec.id if prod_rec else False,
                'item_name': i_name or '(Draft)',
                'roll_qty': roll_qty,
                'qty': qty,
                'unit': unit,
                'price_per_unit': price,
                'total_price': total,
                'note': note,
                'roll_meters_str': roll_str,
                'is_unpaid': is_unpaid
            }
            line_id = l.get('id')
            if line_id and line_id in existing_sale_ids:
                processed_sale_lines.append((1, line_id, vals))
                existing_sale_ids.remove(line_id)
            else:
                processed_sale_lines.append((0, 0, vals))
        
        for rem_id in existing_sale_ids:
            processed_sale_lines.append((2, rem_id, 0))

        existing_cashin_ids = sheet.cashin_line_ids.ids if sheet else []
        processed_cashin_lines = []
        for l in cashin_lines:
            note_val = (l.get('note') or '').strip()
            c_name = (l.get('customer_name') or '').strip()
            money_val = safe_float(l.get('money'))
            is_khata = bool(l.get('is_khata'))

            if not note_val and not c_name and money_val == 0:
                continue

            target_cust_name = c_name
            cust_rec = False
            if target_cust_name:
                cust_rec = cust_model.search([('name', '=ilike', target_cust_name)], limit=1)
                if not cust_rec and (is_khata or c_name) and not is_silent:
                    cust_rec = cust_model.create({'name': target_cust_name})

            vals = {
                'customer_id': cust_rec.id if cust_rec else False,
                'customer_name': target_cust_name,
                'note': note_val or '(Draft)',
                'money': money_val,
                'is_khata': is_khata
            }
            line_id = l.get('id')
            if line_id and line_id in existing_cashin_ids:
                processed_cashin_lines.append((1, line_id, vals))
                existing_cashin_ids.remove(line_id)
            else:
                processed_cashin_lines.append((0, 0, vals))
                
        for rem_id in existing_cashin_ids:
            processed_cashin_lines.append((2, rem_id, 0))


        existing_cashout_ids = sheet.cashout_line_ids.ids if sheet else []
        processed_cashout_lines = []
        for l in cashout_lines:
            note_val = (l.get('note') or '').strip()
            c_name = (l.get('customer_name') or '').strip()
            money_val = safe_float(l.get('money'))
            is_khata = bool(l.get('is_khata'))

            if not note_val and not c_name and money_val == 0:
                continue

            target_cust_name = c_name

            cust_rec = False
            if target_cust_name:
                cust_rec = cust_model.search([('name', '=ilike', target_cust_name)], limit=1)
                if not cust_rec and (is_khata or c_name) and not is_silent:
                    cust_rec = cust_model.create({'name': target_cust_name})

            vals = {
                'customer_id': cust_rec.id if cust_rec else False,
                'customer_name': target_cust_name,
                'note': note_val or '(Draft)',
                'money': money_val,
                'is_khata': is_khata
            }
            line_id = l.get('id')
            if line_id and line_id in existing_cashout_ids:
                processed_cashout_lines.append((1, line_id, vals))
                existing_cashout_ids.remove(line_id)
            else:
                processed_cashout_lines.append((0, 0, vals))
                
        for rem_id in existing_cashout_ids:
            processed_cashout_lines.append((2, rem_id, 0))


        existing_shopexp_ids = sheet.shopexp_line_ids.ids if sheet else []
        shopexp_lines_processed = []
        for l in shopexp_lines:
            n_val = (l.get('note') or '').strip()
            m_val = safe_float(l.get('money'))
            if not n_val and m_val == 0:
                continue
            vals = {
                'note': n_val or '(Draft)',
                'money': m_val
            }
            line_id = l.get('id')
            if line_id and line_id in existing_shopexp_ids:
                shopexp_lines_processed.append((1, line_id, vals))
                existing_shopexp_ids.remove(line_id)
            else:
                shopexp_lines_processed.append((0, 0, vals))
                
        for rem_id in existing_shopexp_ids:
            shopexp_lines_processed.append((2, rem_id, 0))


        existing_homeexp_ids = sheet.homeexp_line_ids.ids if sheet else []
        homeexp_lines_processed = []
        for l in homeexp_lines:
            n_val = (l.get('note') or '').strip()
            m_val = safe_float(l.get('money'))
            if not n_val and m_val == 0:
                continue
            vals = {
                'note': n_val or '(Draft)',
                'money': m_val
            }
            line_id = l.get('id')
            if line_id and line_id in existing_homeexp_ids:
                homeexp_lines_processed.append((1, line_id, vals))
                existing_homeexp_ids.remove(line_id)
            else:
                homeexp_lines_processed.append((0, 0, vals))
                
        for rem_id in existing_homeexp_ids:
            homeexp_lines_processed.append((2, rem_id, 0))

        vals = {
            'date': date_str,
            'last_balance': safe_float(last_balance),
            'sale_line_ids': processed_sale_lines,
            'cashin_line_ids': processed_cashin_lines,
            'cashout_line_ids': processed_cashout_lines,
            'shopexp_line_ids': shopexp_lines_processed,
            'homeexp_line_ids': homeexp_lines_processed,
        }

        user_name = request.env.user.name or 'User'
        now_dt = fields.Datetime.now()
        now_str = fields.Datetime.context_timestamp(request.env.user, now_dt).strftime('%d/%m/%Y %I:%M %p')

        if sheet:
            sheet.write(vals)
            sheet.message_post(
                body=f"<b>Sheet Updated by {user_name}</b> at {now_str}<br/>Total Sale: {sheet.total_sale:,.2f} | Current Balance: {sheet.current_day_balance:,.2f}"
            )
        else:
            sheet = sheet_model.create(vals)
            sheet.message_post(
                body=f"<b>Sheet Created by {user_name}</b> at {now_str}"
            )

        create_user = sheet.create_uid.name if sheet.create_uid else user_name
        create_time = fields.Datetime.context_timestamp(request.env.user, sheet.create_date).strftime('%d/%m/%Y %I:%M %p') if sheet.create_date else now_str
        write_user = sheet.write_uid.name if sheet.write_uid else user_name
        write_time = fields.Datetime.context_timestamp(request.env.user, sheet.write_date).strftime('%d/%m/%Y %I:%M %p') if sheet.write_date else now_str

        msgs = request.env['mail.message'].sudo().search([
            ('model', '=', 'fabric.daily.sheet'),
            ('res_id', '=', sheet.id)
        ], order='id desc', limit=15)
        history_logs = []
        for m in msgs:
            author_name = m.author_id.name or m.create_uid.name or 'System'
            msg_time = fields.Datetime.context_timestamp(request.env.user, m.date).strftime('%d/%m/%Y %I:%M %p') if m.date else ''
            history_logs.append({
                'id': m.id,
                'author': author_name,
                'time': msg_time,
                'body': m.body or ''
            })

        products = request.env['fabric.product'].sudo().search_read([], ['id', 'name', 'code', 'unit', 'price_per_unit', 'quantity'])
        customers = request.env['fabric.customer'].sudo().search_read([], ['id', 'name', 'phone', 'current_net_balance'])
        saved_sale_lines = [{
            'id': l.id,
            'customer_name': l.customer_name or '',
            'item_name': l.item_name or '',
            'qty': l.qty,
        } for l in sheet.sale_line_ids]

        return {
            'status': 'success',
            'sheet_id': sheet.id,
            'create_user': create_user,
            'create_time': create_time,
            'write_user': write_user,
            'write_time': write_time,
            'history_logs': history_logs,
            'sale_lines_data': saved_sale_lines,
            'products': products,
            'customers': customers
        }

    @http.route('/fabric_erp/delete_sale_line', type='json', auth='user')
    def delete_sale_line(self, line_id, increase_stock=True):
        try:
            line_id = int(line_id)
        except (ValueError, TypeError):
            return {'status': 'error', 'message': 'Invalid line ID'}

        sale_line = request.env['fabric.daily.sale.line'].sudo().browse(line_id)
        if sale_line.exists():
            sheet = sale_line.sheet_id
            product = sale_line.product_id
            if not product and sale_line.item_name:
                product = request.env['fabric.product'].sudo().search([('name', '=ilike', sale_line.item_name.strip())], limit=1)

            ctx = dict(request.env.context, keep_stock_deducted=not increase_stock)
            sale_line.with_context(ctx).unlink()

            if product:
                product._compute_quantity()
            if sheet:
                sheet._compute_sheet_totals()

        products = request.env['fabric.product'].sudo().search_read([], ['id', 'name', 'code', 'unit', 'price_per_unit', 'quantity'])
        return {'status': 'success', 'products': products}

    @http.route('/fabric_erp/get_temp_visit_notes', type='json', auth='user')
    def get_temp_visit_notes(self):
        from datetime import timedelta
        note_model = request.env['fabric.visit.note'].sudo()
        domain = [
            '|',
            ('is_credited', '=', False),
            '&',
            ('is_credited', '=', True),
            ('date', '>=', fields.Datetime.now() - timedelta(hours=24))
        ]
        notes = note_model.search(domain, order='date desc, id desc')

        res = []
        now = fields.Datetime.now()
        for n in notes:
            disp_dt = n.credited_date if (n.is_credited and n.credited_date) else n.date
            dt_local = fields.Datetime.context_timestamp(request.env['fabric.visit.note'], disp_dt) if disp_dt else now
            date_local = fields.Datetime.context_timestamp(request.env['fabric.visit.note'], n.date) if n.date else now
            diff_sec = (now - n.date).total_seconds() if n.date else 0
            if diff_sec < 60:
                duration_str = 'Just now'
            elif diff_sec < 3600:
                duration_str = f"{int(diff_sec // 60)} mins ago"
            elif diff_sec < 86400:
                duration_str = f"{int(diff_sec // 3600)} hrs ago"
            else:
                duration_str = f"{int(diff_sec // 86400)} days ago"

            res.append({
                'id': n.id,
                'description': n.description,
                'rollQty': n.roll_qty,
                'qty': n.qty,
                'unit': n.unit or 'Meter',
                'roll_meters_str': n.roll_meters_str or '',
                'amount': n.amount,
                'isCredited': n.is_credited,
                'createdAt': (n.date.isoformat() + 'Z') if n.date else '',
                'creditedAt': (n.credited_date.isoformat() + 'Z') if n.credited_date else '',
                'formattedTime': dt_local.strftime('%I:%M %p'),
                'date12h': date_local.strftime('%d/%m/%Y %I:%M %p'),
                'durationStr': duration_str
            })
        return res

    @http.route('/fabric_erp/add_temp_visit_note', type='json', auth='user')
    def add_temp_visit_note(self, description, amount, is_credited, roll_qty=0.0, qty=0.0, unit='Meter', roll_meters_str=''):
        def safe_float(val):
            if not val:
                return 0.0
            try:
                if isinstance(val, str) and not val.strip():
                    return 0.0
                return float(val)
            except ValueError:
                return 0.0

        is_cred = bool(is_credited)
        now_dt = fields.Datetime.now()
        note = request.env['fabric.visit.note'].sudo().create({
            'description': description or 'Customer Shop Visit Note',
            'roll_qty': safe_float(roll_qty),
            'qty': safe_float(qty),
            'unit': unit or 'Meter',
            'roll_meters_str': roll_meters_str or '',
            'amount': safe_float(amount),
            'is_credited': is_cred,
            'date': now_dt,
            'credited_date': now_dt if is_cred else False,
        })
        disp_dt = note.credited_date if (note.is_credited and note.credited_date) else note.date
        dt_local = fields.Datetime.context_timestamp(request.env['fabric.visit.note'], disp_dt)
        date_local = fields.Datetime.context_timestamp(request.env['fabric.visit.note'], note.date)
        return {
            'status': 'success',
            'note': {
                'id': note.id,
                'description': note.description,
                'rollQty': note.roll_qty,
                'qty': note.qty,
                'unit': note.unit or 'Meter',
                'roll_meters_str': note.roll_meters_str or '',
                'amount': note.amount,
                'isCredited': note.is_credited,
                'createdAt': (note.date.isoformat() + 'Z') if note.date else '',
                'creditedAt': (note.credited_date.isoformat() + 'Z') if note.credited_date else '',
                'formattedTime': dt_local.strftime('%I:%M %p'),
                'date12h': date_local.strftime('%d/%m/%Y %I:%M %p'),
                'durationStr': 'Just now'
            }
        }

    @http.route('/fabric_erp/toggle_temp_visit_note_credit', type='json', auth='user')
    def toggle_temp_visit_note_credit(self, note_id):
        note = request.env['fabric.visit.note'].sudo().browse(int(note_id))
        if note.exists():
            new_status = not note.is_credited
            vals = {'is_credited': new_status}
            if new_status:
                vals['credited_date'] = fields.Datetime.now()
            else:
                vals['credited_date'] = False
            note.write(vals)

            disp_dt = note.credited_date if (note.is_credited and note.credited_date) else note.date
            dt_local = fields.Datetime.context_timestamp(request.env['fabric.visit.note'], disp_dt) if disp_dt else False
            formatted_time = dt_local.strftime('%I:%M %p') if dt_local else ''
            return {
                'status': 'success',
                'isCredited': note.is_credited,
                'creditedAt': (note.credited_date.isoformat() + 'Z') if note.credited_date else '',
                'formattedTime': formatted_time
            }
        return {'status': 'error', 'message': 'Note not found'}

    @http.route('/fabric_erp/delete_temp_visit_note', type='json', auth='user')
    def delete_temp_visit_note(self, note_id):
        note = request.env['fabric.visit.note'].sudo().browse(int(note_id))
        if note.exists():
            note.unlink()
            return {'status': 'success'}
        return {'status': 'error'}

    @http.route('/fabric_erp/clear_all_temp_visit_notes', type='json', auth='user')
    def clear_all_temp_visit_notes(self):
        notes = request.env['fabric.visit.note'].sudo().search([])
        notes.unlink()
        return {'status': 'success'}



