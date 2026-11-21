from freqtrade.strategy import IStrategy
from pandas import DataFrame


class AQDonchianBreakoutTrial001(IStrategy):
    INTERFACE_VERSION = 3
    timeframe = "1h"
    can_short = False
    process_only_new_candles = True
    startup_candle_count = 120
    stoploss = -0.12
    minimal_roi = {"0": 0.04}

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe["donchian_high"] = dataframe["high"].rolling(20).max().shift(1)
        dataframe["donchian_low"] = dataframe["low"].rolling(20).min().shift(1)
        dataframe["volume_sma"] = dataframe["volume"].rolling(20).mean()
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        entry = (
            (dataframe["close"] > dataframe["donchian_high"]) &
            (dataframe["volume"] > dataframe["volume_sma"])
        )
        dataframe.loc[entry, "enter_long"] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[dataframe["close"] < dataframe["donchian_low"], "exit_long"] = 1
        return dataframe
