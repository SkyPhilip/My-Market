/**
 * Static sector-to-symbols mapping.
 * Top 30 equities per sector by market cap / institutional relevance.
 * Used with Alpaca snapshots for live price + volume data.
 */
export const SECTOR_SYMBOLS: Record<string, string[]> = {
  'Technology': [
    'AAPL', 'MSFT', 'NVDA', 'AVGO', 'ORCL', 'CRM', 'ADBE', 'AMD', 'CSCO', 'INTC',
    'QCOM', 'IBM', 'TXN', 'NOW', 'INTU', 'AMAT', 'ADI', 'LRCX', 'MU', 'KLAC',
    'SNPS', 'CDNS', 'MRVL', 'FTNT', 'PANW', 'CRWD', 'MSI', 'NXPI', 'APH', 'MCHP'
  ],
  'Healthcare': [
    'UNH', 'JNJ', 'LLY', 'ABBV', 'MRK', 'TMO', 'ABT', 'DHR', 'PFE', 'AMGN',
    'BMY', 'MDT', 'ISRG', 'ELV', 'GILD', 'VRTX', 'CI', 'SYK', 'BSX', 'REGN',
    'ZTS', 'BDX', 'HCA', 'MCK', 'EW', 'IDXX', 'A', 'IQV', 'DXCM', 'MTD'
  ],
  'Financial Services': [
    'BRK.B', 'JPM', 'V', 'MA', 'BAC', 'WFC', 'GS', 'MS', 'SPGI', 'BLK',
    'AXP', 'C', 'SCHW', 'CB', 'MMC', 'PGR', 'ICE', 'AON', 'CME', 'MCO',
    'USB', 'PNC', 'TFC', 'AIG', 'MET', 'AFL', 'TRV', 'ALL', 'PRU', 'MSCI'
  ],
  'Consumer Cyclical': [
    'AMZN', 'TSLA', 'HD', 'MCD', 'NKE', 'LOW', 'SBUX', 'TJX', 'BKNG', 'MAR',
    'CMG', 'ORLY', 'GM', 'F', 'DHI', 'AZO', 'ROST', 'LEN', 'YUM', 'HLT',
    'EBAY', 'DKNG', 'DG', 'DLTR', 'BBY', 'APTV', 'GRMN', 'PHM', 'POOL', 'TSCO'
  ],
  'Communication Services': [
    'GOOG', 'META', 'NFLX', 'DIS', 'CMCSA', 'TMUS', 'VZ', 'T', 'CHTR', 'EA',
    'ATVI', 'TTWO', 'MTCH', 'WBD', 'PARA', 'LYV', 'RBLX', 'ZM', 'PINS', 'SNAP',
    'ROKU', 'SPOT', 'IACI', 'OMC', 'IPG', 'FOX', 'FOXA', 'NWSA', 'NWS', 'LUMN'
  ],
  'Industrials': [
    'GE', 'CAT', 'RTX', 'HON', 'UNP', 'UPS', 'BA', 'DE', 'LMT', 'ADP',
    'MMM', 'GD', 'ITW', 'NOC', 'CSX', 'NSC', 'WM', 'EMR', 'FDX', 'ETN',
    'PH', 'TT', 'CARR', 'CTAS', 'PCAR', 'ROK', 'FAST', 'VRSK', 'IR', 'AME'
  ],
  'Consumer Defensive': [
    'WMT', 'PG', 'KO', 'PEP', 'COST', 'PM', 'MO', 'MDLZ', 'CL', 'KHC',
    'STZ', 'GIS', 'SYY', 'ADM', 'KMB', 'HSY', 'MKC', 'K', 'CAG', 'CPB',
    'SJM', 'HRL', 'TSN', 'CHD', 'CLX', 'WBA', 'KR', 'EL', 'MNST', 'BF.B'
  ],
  'Energy': [
    'XOM', 'CVX', 'COP', 'EOG', 'SLB', 'MPC', 'PSX', 'VLO', 'PXD', 'OXY',
    'WMB', 'HES', 'DVN', 'HAL', 'KMI', 'BKR', 'FANG', 'TRGP', 'OKE', 'CTRA',
    'EQT', 'MRO', 'APA', 'MTDR', 'AR', 'RRC', 'SM', 'DEN', 'CHRD', 'PR'
  ],
  'Utilities': [
    'NEE', 'DUK', 'SO', 'D', 'AEP', 'SRE', 'EXC', 'XEL', 'ED', 'PCG',
    'WEC', 'ES', 'AWK', 'EIX', 'DTE', 'PPL', 'FE', 'AEE', 'CMS', 'CEG',
    'ETR', 'ATO', 'CNP', 'EVRG', 'NI', 'PNW', 'LNT', 'NRG', 'AES', 'OGE'
  ],
  'Real Estate': [
    'PLD', 'AMT', 'EQIX', 'CCI', 'PSA', 'O', 'WELL', 'DLR', 'SPG', 'VICI',
    'AVB', 'EQR', 'ARE', 'VTR', 'IRM', 'SBAC', 'WY', 'MAA', 'UDR', 'ESS',
    'PEAK', 'KIM', 'REG', 'BXP', 'CPT', 'HST', 'INVH', 'SUI', 'ELS', 'CUBE'
  ],
  'Basic Materials': [
    'LIN', 'APD', 'SHW', 'ECL', 'FCX', 'NEM', 'NUE', 'DOW', 'DD', 'PPG',
    'CTVA', 'VMC', 'MLM', 'ALB', 'IFF', 'CE', 'FMC', 'EMN', 'BALL', 'PKG',
    'AVY', 'IP', 'CF', 'MOS', 'RPM', 'SEE', 'OLN', 'HUN', 'WRK', 'AXTA'
  ],
};
